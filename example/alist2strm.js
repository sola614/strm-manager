const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');
const { postGetQuery } = require('./utils/req');
const {
  OP_OLIST_TOKEN,
  OP_OLIST_DOMAIN,
  ALIST2STRM_SFTP_HOST,
  ALIST2STRM_SFTP_PORT,
  ALIST2STRM_SFTP_USERNAME,
  ALIST2STRM_SFTP_PASSWORD,
  ALIST2STRM_SFTP_PRIVATE_KEY,
  ALIST2STRM_CONCURRENCY,
  ALIST2STRM_PAGE_SIZE,
  ALIST2STRM_CONNECT_TIMEOUT
} = require('./utils/config');

const mediaFileReg = /\.(mkv|mp4|flac|mp3|wav)$/i;
const downloadFileReg = /\.(srt|ass)$/i;
const supportedFileReg = /\.(mkv|mp4|flac|mp3|wav|srt|ass)$/i;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_PAGE_SIZE = 1000;

module.exports = (req, res) => {
  postGetQuery(req)
    .then((query) => {
      console.log('[alist2strm info]接收到的参数:', JSON.stringify(query));

      const { sourcePath, targetPath } = query || {};
      if (!sourcePath || !targetPath) {
        sendJson(res, {
          code: 500,
          message: '所需路径不存在！'
        });
        return;
      }

      runTask(query).catch((error) => {
        console.error('[alist2strm error]任务执行失败:', error);
      });

      sendJson(res, {
        code: 0,
        message: '生成strm任务开始！'
      });
    })
    .catch((err) => {
      res.writeHead(err.code || 400, { 'Content-Type': 'text/plain' });
      res.end(err.message);
    });
};

async function runTask(taskParams) {
  const { sourcePath, targetPath } = taskParams;
  const localDir = await createTempTaskDir();

  try {
    if (mediaFileReg.test(sourcePath)) {
      await getFileInfo({ path: sourcePath, localDir, taskParams });
      console.log(`[alist2strm info]【${sourcePath}】文件处理完毕，开始传输文件到【${targetPath}】下...`);
    } else {
      await handleGetList({ path: sourcePath, localDir, taskParams });
      console.log(`[alist2strm info]【${sourcePath}】目录下文件处理完毕，开始传输文件到【${targetPath}】下...`);
    }

    await ssh2File({ localDir, remoteDir: targetPath });
    console.log(`[alist2strm info]文件传输完毕，开始删除本地临时目录【${localDir}】`);
  } finally {
    await delLocalFiles(localDir).catch((error) => {
      console.error('[alist2strm error]删除本地临时目录失败:', error);
    });
  }
}

async function createTempTaskDir() {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'alist2strm-'));
}

// 获取文件信息
async function getFileInfo({ path: filePath, localDir, taskParams } = {}) {
  const { data: res } = await axios.post(
    `${OP_OLIST_DOMAIN}/api/fs/get`,
    {
      path: filePath,
      page: 1,
      refresh: true,
      per_page: DEFAULT_PAGE_SIZE
    },
    {
      headers: {
        Authorization: OP_OLIST_TOKEN
      }
    }
  );

  if (res && res.code === 200) {
    await saveFile({ item: res.data, path: filePath, localDir, taskParams });
    return;
  }

  throw new Error(`获取文件信息出错: ${JSON.stringify(res)}`);
}

// 列出文件目录
async function handleGetList({ path: dirPath, pathPrefix = '', localDir, taskParams } = {}) {
  let page = 1;
  const perPage = getPositiveInteger(ALIST2STRM_PAGE_SIZE, DEFAULT_PAGE_SIZE);

  while (true) {
    const { data: res } = await axios.post(
      `${OP_OLIST_DOMAIN}/api/fs/list`,
      {
        path: dirPath,
        page,
        refresh: page === 1,
        per_page: perPage
      },
      {
        headers: {
          Authorization: OP_OLIST_TOKEN
        }
      }
    );

    if (!res || res.code !== 200) {
      throw new Error(`列出目录失败: ${dirPath}, ${JSON.stringify(res)}`);
    }

    const { content, total } = res.data || {};
    const files = Array.isArray(content) ? content : [];
    await runWithConcurrency(files, getPositiveInteger(ALIST2STRM_CONCURRENCY, DEFAULT_CONCURRENCY), async (item) => {
      if (!isSafePathPart(item.name)) {
        console.error(`[alist2strm error]检测到不安全的文件名【${item.name}】，跳过`);
        return;
      }

      if (item.is_dir) {
        await handleGetList({
          path: joinAlistPath(dirPath, item.name),
          pathPrefix: path.posix.join(pathPrefix, item.name),
          localDir,
          taskParams
        });
        return;
      }

      await saveFile({ item, pathPrefix, path: dirPath, localDir, taskParams });
    });

    const totalCount = Number.parseInt(total, 10);
    const hasTotal = Number.isInteger(totalCount) && totalCount >= 0;
    const processed = page * perPage;
    if (files.length < perPage || (hasTotal && processed >= totalCount)) {
      break;
    }
    page += 1;
  }
}

async function saveFile({ item, pathPrefix = '', path: sourceDir, localDir, taskParams }) {
  if (!item || !supportedFileReg.test(item.name)) {
    console.error(`[alist2strm error]检测到不符合要求格式文件【${item && item.name}】，跳过`);
    return false;
  }

  if (!isSafePathPart(item.name)) {
    console.error(`[alist2strm error]检测到不安全的文件名【${item.name}】，跳过`);
    return false;
  }

  const { domain } = taskParams || {};
  const saveDir = path.join(localDir, pathPrefix);
  await fs.promises.mkdir(saveDir, { recursive: true });

  const saveUrl = buildDownloadUrl({
    domain: domain || OP_OLIST_DOMAIN,
    sourcePath: sourceDir,
    fileName: item.name,
    sign: item.sign
  });

  if (downloadFileReg.test(item.name)) {
    const downloadUrl = buildDownloadUrl({
      domain: OP_OLIST_DOMAIN,
      sourcePath: sourceDir,
      fileName: item.name,
      sign: item.sign
    });
    await downloadFileFn(downloadUrl, { outputDir: saveDir, fileName: item.name });
    return false;
  }

  const savePath = path.join(saveDir, item.name.replace(mediaFileReg, '.strm'));
  await fs.promises.writeFile(savePath, saveUrl, 'utf8');
  return false;
}

function buildDownloadUrl({ domain, sourcePath, fileName, sign }) {
  const sourceParts = sourcePath.split('/').filter(Boolean);
  if (mediaFileReg.test(sourcePath)) {
    sourceParts.pop();
  }

  const encodedPath = sourceParts.map((str) => encodeURIComponent(str)).join('/');
  const dirPath = encodedPath ? `/${encodedPath}` : '';
  const signQuery = sign ? `?sign=${encodeURIComponent(sign)}` : '';
  return `${domain.replace(/\/+$/, '')}/d${dirPath}/${encodeURIComponent(fileName)}${signQuery}`;
}

function joinAlistPath(basePath, name) {
  if (!basePath || basePath === '/') {
    return `/${name}`;
  }

  return `${basePath.replace(/\/+$/, '')}/${name}`;
}

function isSafePathPart(name) {
  return Boolean(name) && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

function ssh2File({ localDir, remoteDir }) {
  if (!fs.existsSync(localDir)) {
    return Promise.reject(new Error(`不存在可传输目录：${localDir}`));
  }

  const config = getSftpConfig();
  const remoteDirPath = normalizeRemotePath(remoteDir);

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      conn.end();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            finish(err);
            return;
          }

          ensureRemoteDirExists(sftp, remoteDirPath, (mkdirErr) => {
            if (mkdirErr) {
              finish(mkdirErr);
              return;
            }

            syncLocalToRemote(sftp, localDir, remoteDirPath, finish);
          });
        });
      })
      .on('error', finish)
      .on('timeout', () => finish(new Error('SSH 连接超时')))
      .connect(config);
  });
}

function getSftpConfig() {
  if (!ALIST2STRM_SFTP_HOST || !ALIST2STRM_SFTP_USERNAME) {
    throw new Error('缺少 SFTP 配置，请配置 ALIST2STRM_SFTP_HOST 和 ALIST2STRM_SFTP_USERNAME');
  }

  if (!ALIST2STRM_SFTP_PASSWORD && !ALIST2STRM_SFTP_PRIVATE_KEY) {
    throw new Error('缺少 SFTP 认证信息，请配置 ALIST2STRM_SFTP_PASSWORD 或 ALIST2STRM_SFTP_PRIVATE_KEY');
  }

  const config = {
    host: ALIST2STRM_SFTP_HOST,
    port: getPositiveInteger(ALIST2STRM_SFTP_PORT, 22),
    username: ALIST2STRM_SFTP_USERNAME,
    readyTimeout: getPositiveInteger(ALIST2STRM_CONNECT_TIMEOUT, 20000)
  };

  if (ALIST2STRM_SFTP_PRIVATE_KEY) {
    config.privateKey = ALIST2STRM_SFTP_PRIVATE_KEY;
  } else {
    config.password = ALIST2STRM_SFTP_PASSWORD;
  }

  return config;
}

function normalizeRemotePath(remotePath) {
  const normalized = String(remotePath || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized || normalized === '.') {
    throw new Error('远程目录不能为空');
  }
  return normalized;
}

// 确保远程目录存在，如果不存在则逐级创建
function ensureRemoteDirExists(sftp, remoteDirPath, callback) {
  const normalizedDir = normalizeRemotePath(remoteDirPath);
  const parts = normalizedDir.split('/').filter(Boolean);
  const isAbsolute = normalizedDir.startsWith('/');
  let currentPath = isAbsolute ? '/' : '';

  runSeries(
    parts,
    (part, next) => {
      currentPath = currentPath === '/' ? `/${part}` : path.posix.join(currentPath, part);
      sftp.mkdir(currentPath, (err) => {
        if (err && err.code !== 4) {
          next(err);
          return;
        }
        next();
      });
    },
    callback
  );
}

// 同步本地目录到远程相同目录
function syncLocalToRemote(sftp, localDirPath, remoteDirPath, callback) {
  fs.readdir(localDirPath, { withFileTypes: true }, (err, entries) => {
    if (err) {
      callback(err);
      return;
    }

    runWithCallbackConcurrency(
      entries,
      getPositiveInteger(ALIST2STRM_CONCURRENCY, DEFAULT_CONCURRENCY),
      (entry, next) => {
        const localFilePath = path.join(localDirPath, entry.name);
        const remoteFilePath = path.posix.join(remoteDirPath, entry.name);

        if (entry.isDirectory()) {
          ensureRemoteDirExists(sftp, remoteFilePath, (mkdirErr) => {
            if (mkdirErr) {
              next(mkdirErr);
              return;
            }
            syncLocalToRemote(sftp, localFilePath, remoteFilePath, next);
          });
          return;
        }

        if (entry.isFile()) {
          sftp.fastPut(localFilePath, remoteFilePath, next);
          return;
        }

        next();
      },
      callback
    );
  });
}

async function delLocalFiles(targetPath) {
  if (!isSafeTempTaskDir(targetPath)) {
    throw new Error(`拒绝删除非 alist2strm 临时目录：${targetPath}`);
  }

  await fs.promises.rm(targetPath, { recursive: true, force: true });
  console.log('[alist2strm info]本地临时目录删除完毕');
}

function isSafeTempTaskDir(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedTemp = path.resolve(os.tmpdir());
  return (
    resolvedTarget.startsWith(`${resolvedTemp}${path.sep}`) &&
    path.basename(resolvedTarget).startsWith('alist2strm-')
  );
}

async function downloadFileFn(url, { outputDir, fileName }) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  const filePath = path.join(outputDir, fileName);
  const writer = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', () => resolve(filePath));
    writer.on('error', (err) => {
      fs.unlink(filePath, () => reject(err));
    });
    response.data.on('error', (err) => {
      writer.destroy();
      fs.unlink(filePath, () => reject(err));
    });
  });
}

async function runWithConcurrency(items, concurrency, handler) {
  let index = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await handler(item);
    }
  });

  await Promise.all(workers);
}

function runWithCallbackConcurrency(items, concurrency, handler, callback) {
  if (!items.length) {
    callback();
    return;
  }

  let index = 0;
  let running = 0;
  let finished = 0;
  let done = false;

  const next = (err) => {
    if (done) {
      return;
    }

    if (err) {
      done = true;
      callback(err);
      return;
    }

    finished += 1;
    running -= 1;
    schedule();
  };

  const schedule = () => {
    if (done) {
      return;
    }

    if (finished === items.length) {
      done = true;
      callback();
      return;
    }

    while (running < concurrency && index < items.length) {
      const item = items[index];
      index += 1;
      running += 1;
      try {
        handler(item, next);
      } catch (error) {
        next(error);
      }
    }
  };

  schedule();
}

function runSeries(items, handler, callback) {
  let index = 0;

  const next = (err) => {
    if (err) {
      callback(err);
      return;
    }

    if (index >= items.length) {
      callback();
      return;
    }

    const item = items[index];
    index += 1;
    handler(item, next);
  };

  next();
}

function getPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sendJson(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json;charset=UTF-8'
  });
  res.end(JSON.stringify(data));
}
