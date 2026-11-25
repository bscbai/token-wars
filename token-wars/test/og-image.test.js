/**
 * 社交分享卡（client/og-image.png）
 *
 * 所有分享页的 og:image 都指向它；尺寸必须是 1200×630（Twitter/OG 大图），
 * 体积过大或尺寸错误会让链接预览被裁剪或加载失败。
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'client', 'og-image.png');

describe('og-image.png', () => {
  it('存在且是 1200×630 的 PNG', () => {
    expect(fs.existsSync(FILE)).toBe(true);
    const buf = fs.readFileSync(FILE);
    expect(buf.slice(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });

  it('体积适合社交抓取（< 300 KB）', () => {
    expect(fs.statSync(FILE).size).toBeLessThan(300 * 1024);
  });
});
