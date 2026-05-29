import fs from 'node:fs';
import path from 'node:path';
import { hashValue } from '../utils/id.js';
import { isSafePathPart } from '../utils/paths.js';
import { sanitizeText } from '../utils/validators.js';

export function createFileManager({ loadTasks, formatError }) {
  async function buildManagedFilesPayload(rootId = '', directory = '') {
    const roots = await loadManagedFileRoots();
    const selectedRoot = resolveManagedFileRoot(roots, rootId);
    const normalizedDirectory = normalizeManagedDirectory(directory);
    const parentDirectory = normalizedDirectory ? getParentManagedDirectory(normalizedDirectory) : null;

    let entries = [];
    if (selectedRoot?.exists) {
      entries = await listManagedDirectoryEntries(selectedRoot, normalizedDirectory);
    }

    return {
      roots,
      currentRootId: selectedRoot?.id || null,
      currentDirectory: normalizedDirectory,
      parentDirectory,
      entries,
    };
  }

  async function loadManagedFileRoots() {
    const tasks = loadTasks();
    const groupedRoots = new Map();

    for (const task of tasks) {
      const targetPath = sanitizeText(task.targetPath);
      if (!targetPath) continue;

      const resolvedPath = path.resolve(targetPath);
      if (!groupedRoots.has(resolvedPath)) {
        groupedRoots.set(resolvedPath, {
          id: hashValue(`managed-root:${resolvedPath}`),
          targetPath,
          configuredPaths: [],
          resolvedPath,
          taskIds: [],
          taskNames: [],
          exists: false,
          error: '',
        });
      }

      const root = groupedRoots.get(resolvedPath);
      if (!root.configuredPaths.includes(targetPath)) {
        root.configuredPaths.push(targetPath);
      }
      if (!root.taskIds.includes(task.id)) {
        root.taskIds.push(task.id);
      }
      if (!root.taskNames.includes(task.name)) {
        root.taskNames.push(task.name);
      }
    }

    const roots = Array.from(groupedRoots.values()).sort((left, right) =>
      left.targetPath.localeCompare(right.targetPath, 'zh-CN'),
    );

    await Promise.all(
      roots.map(async (root) => {
        try {
          const stat = await fs.promises.stat(root.resolvedPath);
          if (!stat.isDirectory()) {
            root.exists = false;
            root.error = '目标路径不是文件夹。';
            return;
          }

          root.exists = true;
        } catch (error) {
          root.exists = false;
          root.error = error?.code === 'ENOENT' ? '目录不存在。' : formatError(error);
        }
      }),
    );

    return roots;
  }

  function resolveManagedFileRoot(roots, rootId) {
    if (!roots.length) return null;
    if (rootId) {
      const matchedRoot = roots.find((root) => root.id === rootId);
      if (!matchedRoot) {
        const error = new Error('目标目录不存在。');
        error.status = 404;
        error.code = 'FILE_ROOT_NOT_FOUND';
        throw error;
      }
      return matchedRoot;
    }
    return roots[0];
  }

  async function listManagedDirectoryEntries(root, directory) {
    const absoluteDirectoryPath = resolveManagedFileAbsolutePath(root, directory);
    const stat = await fs.promises.stat(absoluteDirectoryPath);
    if (!stat.isDirectory()) {
      const error = new Error('当前路径不是文件夹。');
      error.status = 400;
      error.code = 'FILE_DIRECTORY_INVALID';
      throw error;
    }

    const entries = [];
    const dirents = await fs.promises.readdir(absoluteDirectoryPath, {
      withFileTypes: true,
    });

    dirents.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name, 'zh-CN');
    });

    for (const dirent of dirents) {
      if (!isSafePathPart(dirent.name)) continue;

      const childRelativePath = directory ? path.posix.join(directory, dirent.name) : dirent.name;
      const absolutePath = resolveManagedFileAbsolutePath(root, childRelativePath);
      const childStat = await fs.promises.stat(absolutePath);
      const normalizedRelativePath = childRelativePath.replace(/\\/g, '/');

      entries.push({
        id: hashValue(`${root.id}:${normalizedRelativePath}:${dirent.isDirectory() ? 'd' : 'f'}`),
        rootId: root.id,
        targetPath: root.targetPath,
        resolvedRootPath: root.resolvedPath,
        relativePath: normalizedRelativePath,
        name: dirent.name,
        type: dirent.isDirectory() ? 'directory' : 'file',
        size: dirent.isDirectory() ? 0 : childStat.size,
        updatedAt: childStat.mtime ? childStat.mtime.toISOString() : null,
      });
    }

    return entries;
  }

  async function deleteManagedFileEntry(rootId, relativePath) {
    const roots = await loadManagedFileRoots();
    const root = resolveManagedFileRoot(roots, rootId);
    const normalizedRelativePath = normalizeManagedDirectory(relativePath);

    if (!normalizedRelativePath) {
      const error = new Error('不能删除根目录。');
      error.status = 400;
      error.code = 'FILE_DELETE_ROOT_FORBIDDEN';
      throw error;
    }

    const absolutePath = resolveManagedFileAbsolutePath(root, normalizedRelativePath);
    await fs.promises.rm(absolutePath, { recursive: true, force: false });
  }

  async function deleteManagedFileEntries(rootId, relativePaths) {
    if (!relativePaths.length) {
      const error = new Error('请至少选择一项。');
      error.status = 400;
      error.code = 'FILE_DELETE_EMPTY';
      throw error;
    }

    for (const relativePath of relativePaths) {
      await deleteManagedFileEntry(rootId, relativePath);
    }

    return relativePaths.length;
  }

  async function readManagedStrmFileContent(rootId, relativePath) {
    const roots = await loadManagedFileRoots();
    const root = resolveManagedFileRoot(roots, rootId);
    const normalizedRelativePath = normalizeManagedDirectory(relativePath);

    if (!normalizedRelativePath || path.extname(normalizedRelativePath).toLowerCase() !== '.strm') {
      const error = new Error('仅支持查看 .strm 文件内容。');
      error.status = 400;
      error.code = 'FILE_CONTENT_UNSUPPORTED';
      throw error;
    }

    const absolutePath = resolveManagedFileAbsolutePath(root, normalizedRelativePath);
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) {
      const error = new Error('目标不是文件。');
      error.status = 400;
      error.code = 'FILE_CONTENT_NOT_FILE';
      throw error;
    }

    if (stat.size > 1024 * 1024) {
      const error = new Error('文件过大，暂不支持在线查看。');
      error.status = 413;
      error.code = 'FILE_CONTENT_TOO_LARGE';
      throw error;
    }

    return {
      name: path.basename(normalizedRelativePath),
      relativePath: normalizedRelativePath,
      content: await fs.promises.readFile(absolutePath, 'utf8'),
      updatedAt: stat.mtime ? stat.mtime.toISOString() : null,
    };
  }

  return {
    buildManagedFilesPayload,
    deleteManagedFileEntry,
    deleteManagedFileEntries,
    readManagedStrmFileContent,
  };
}

function normalizeManagedDirectory(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  if (normalized.some((part) => part === '.' || part === '..')) {
    const error = new Error('目录路径不合法。');
    error.status = 400;
    error.code = 'FILE_DIRECTORY_INVALID';
    throw error;
  }

  return normalized.join('/');
}

function getParentManagedDirectory(directory) {
  if (!directory) return null;
  const parts = directory.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function resolveManagedFileAbsolutePath(root, relativePath) {
  const normalizedRelativePath = normalizeManagedDirectory(relativePath);
  const absolutePath = path.resolve(root.resolvedPath, normalizedRelativePath || '.');
  const relativeToRoot = path.relative(root.resolvedPath, absolutePath);

  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    const error = new Error('文件路径越界。');
    error.status = 400;
    error.code = 'FILE_PATH_OUT_OF_ROOT';
    throw error;
  }

  return absolutePath;
}
