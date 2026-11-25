/**
 * `npm run simulate` CLI
 *
 * 用真实示例策略跑 3 场，确认 JSON 汇总与退出码；再验证文件缺失/非法参数。
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'simulate-agent.cjs');
const SAMPLE = path.join(ROOT, 'examples', 'sample-bot-node', 'decide.js');

function run(args, opts = {}) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    ...opts,
  });
}

describe('simulate CLI', () => {
  it('示例策略输出 JSON 汇总（场次/胜负/均值）', () => {
    const out = JSON.parse(run([SAMPLE, '--matches', '3', '--json']));
    expect(out.matches).toBe(3);
    expect(out.wins + out.losses + out.draws).toBe(3);
    expect(out.avgTicks).toBeGreaterThan(0);
    expect(out.map).toBe('data_mine');
    expect(typeof out.winRate).toBe('number');
  }, 30000);

  it('可指定地图与决策截止', () => {
    const out = JSON.parse(run([SAMPLE, '--matches', '2', '--map', 'compute_square', '--deadline', '100', '--json']));
    expect(out.matches).toBe(2);
    expect(out.map).toBe('compute_square');
  }, 30000);

  it('文本模式打印胜率与计分行', () => {
    const text = run([SAMPLE, '--matches', '2']);
    expect(text).toMatch(/2W|1W|0W/);
    expect(text).toMatch(/Parity: invalid/);
    expect(text).toMatch(/Timing: decision avg/);
  }, 30000);

  it('--opponent 让两个策略互打', () => {
    const out = JSON.parse(run([SAMPLE, '--opponent', SAMPLE, '--matches', '2', '--json']));
    expect(out.matches).toBe(2);
    expect(out.aWins + out.bWins + out.draws).toBe(2);
    expect(out.opponent).toContain('decide.js');
    expect(typeof out.winRateA).toBe('number');
  }, 30000);

  it('缺失文件时非零退出并给出原因', () => {
    let code = 0;
    let stderr = '';
    try {
      run([path.join(ROOT, 'does-not-exist.js'), '--matches', '1']);
    } catch (err) {
      code = err.status;
      stderr = String(err.stderr || '');
    }
    expect(code).toBe(1);
    expect(stderr).toMatch(/Cannot load/);
  }, 30000);

  it('非法参数以退出码 2 拒绝', () => {
    let code = 0;
    try {
      run([SAMPLE, '--matches', '0']);
    } catch (err) {
      code = err.status;
    }
    expect(code).toBe(2);
  }, 30000);
});
