import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDownloadUrl, buildServiceSourcePath } from './openlistUrl.js';

test('buildDownloadUrl encodes OpenList /d download URL with sign', () => {
  const url = buildDownloadUrl({
    domain: 'http://192.168.0.1:5245/',
    sourcePath: '/tianyi/downloads/Bangumi/更新中/公鸡斗士/Season 1',
    fileName: '公鸡斗士 S01E01.mkv',
    sign: '_Fjhg_A6kBIGAOOtRW-ryiBlhHWZ6rFDHkgEXqqkjaQ=:0',
  });

  assert.equal(
    url,
    'http://192.168.0.1:5245/d/tianyi/downloads/Bangumi/%E6%9B%B4%E6%96%B0%E4%B8%AD/%E5%85%AC%E9%B8%A1%E6%96%97%E5%A3%AB/Season%201/%E5%85%AC%E9%B8%A1%E6%96%97%E5%A3%AB%20S01E01.mkv?sign=_Fjhg_A6kBIGAOOtRW-ryiBlhHWZ6rFDHkgEXqqkjaQ%3D%3A0',
  );
});

test('buildDownloadUrl avoids duplicated file name when sourcePath already points to file', () => {
  const url = buildDownloadUrl({
    domain: 'http://example.test',
    sourcePath: '/media/Movie.mkv',
    fileName: 'Movie.mkv',
    sign: '',
  });

  assert.equal(url, 'http://example.test/d/media/Movie.mkv');
});

test('buildServiceSourcePath joins base path and task source path', () => {
  assert.equal(buildServiceSourcePath('/downloads', '/Bangumi'), '/downloads/Bangumi');
  assert.equal(buildServiceSourcePath('/', '/Bangumi'), '/Bangumi');
  assert.equal(buildServiceSourcePath('/downloads', '/'), '/downloads');
});
