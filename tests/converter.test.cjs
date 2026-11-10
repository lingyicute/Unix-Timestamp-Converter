'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Cannot find source section: ${start}`);
  return html.slice(from, to);
}

// Exercise the shipped inline functions without exporting a browser-only test API.
const { parseTimestamp, epochString, buildResult, maxNs } = vm.runInNewContext([
  section('      const unitNames =', '      const weekdays ='),
  section('      const pad =', '      /* ---------- 实时计时器'),
  section('      function floorDivide(', '      function makeIcon('),
  '({ parseTimestamp, epochString, buildResult, maxNs })'
].join('\n'));

const resultAt = (iso) => buildResult(BigInt(new Date(iso).getTime()) * 1000000n);
const rowOf = (result, label) => result.dates.find((row) => row.label === label);

for (const [iso, rfc2822, rfc3339] of [
  ['-000001-12-31T23:59:59.999Z', false, false],
  ['0000-01-01T00:00:00.000Z', false, true],
  ['0001-01-01T00:00:00.000Z', false, true],
  ['1899-12-31T23:59:59.999Z', false, true],
  ['1900-01-01T00:00:00.000Z', true, true],
  ['9999-12-31T23:59:59.999Z', true, true],
  ['+010000-01-01T00:00:00.000Z', true, false]
]) {
  test(`RFC availability at ${iso}`, () => {
    const result = resultAt(iso);
    assert.equal(rowOf(result, 'RFC 2822').copyable !== false, rfc2822);
    assert.equal(rowOf(result, 'RFC 3339').copyable !== false, rfc3339);
    assert.equal(rowOf(result, 'ISO 8601').value, iso);
    assert.equal(result.timestamps.length, 4);
  });
}

test('ordinary RFC output remains unchanged', () => {
  const result = buildResult(0n);
  assert.equal(rowOf(result, 'RFC 2822').value, 'Thu, 01 Jan 1970 00:00:00 +0000');
  assert.equal(rowOf(result, 'RFC 3339').value, '1970-01-01T00:00:00.000+00:00');
});

test('negative nanoseconds retain their fraction and round-trip in every unit', () => {
  const result = buildResult(-1n);
  assert.equal(rowOf(result, 'ISO 8601').value, '1969-12-31T23:59:59.999999999Z');
  assert.equal(rowOf(result, 'RFC 3339').value, '1969-12-31T23:59:59.999999999+00:00');
  for (const unit of ['s', 'ms', 'us', 'ns']) {
    assert.equal(parseTimestamp(epochString(-1n, unit), unit).ns, -1n);
  }
});

test('RFC year boundaries use the instant, including nanoseconds', () => {
  const year1900 = BigInt(new Date('1900-01-01T00:00:00Z').getTime()) * 1000000n;
  const year0 = BigInt(new Date('0000-01-01T00:00:00Z').getTime()) * 1000000n;
  const year10000 = BigInt(new Date('+010000-01-01T00:00:00Z').getTime()) * 1000000n;
  assert.equal(rowOf(buildResult(year1900 - 1n), 'RFC 2822').copyable, false);
  assert.notEqual(rowOf(buildResult(year1900), 'RFC 2822').copyable, false);
  assert.equal(rowOf(buildResult(year0 - 1n), 'RFC 3339').copyable, false);
  assert.notEqual(rowOf(buildResult(year10000 - 1n), 'RFC 3339').copyable, false);
  assert.equal(rowOf(buildResult(year10000), 'RFC 3339').copyable, false);
});

test('the full existing timestamp range remains convertible', () => {
  for (const ns of [-maxNs, maxNs]) {
    assert.equal(parseTimestamp(ns.toString(), 'ns').ns, ns);
    const result = buildResult(ns);
    assert.equal(rowOf(result, 'RFC 3339').copyable, false);
    assert.equal(rowOf(result, 'ISO 8601').value, new Date(Number(ns / 1000000n)).toISOString());
    for (const unit of ['s', 'ms', 'us', 'ns']) {
      assert.equal(parseTimestamp(epochString(ns, unit), unit).ns, ns);
    }
  }
  assert.throws(() => parseTimestamp((maxNs + 1n).toString(), 'ns'));
});

test('copy buttons are disabled for unavailable formats and recover on the next conversion', () => {
  const rowPool = [];
  const context = vm.createContext({
    currentResult: resultAt('-000001-01-01T00:00:00Z'),
    resultTab: 'dates', lastRenderedTab: 'dates', rowPool,
    els: { resultsBody: {} }, reduceMotion: { matches: true },
    resetCopyButton() {},
    setText(el, text) { el.textContent = text; },
    getRowEntry(index) {
      return rowPool[index] ||= {
        tr: {}, labelSpan: {}, noteSpan: {}, valueTd: {},
        button: { setAttribute() {} }, label: '', note: '', value: ''
      };
    }
  });
  vm.runInContext(section('      function renderResults(', "      els.resultsBody.addEventListener('click'"), context);
  vm.runInContext('renderResults()', context);
  assert.deepEqual(rowPool.map((entry) => entry.button.disabled), [false, false, false, true, true]);
  assert.match(rowPool[3].valueTd.textContent, /1900/);
  assert.match(rowPool[4].valueTd.textContent, /9999/);
  context.currentResult = buildResult(0n);
  vm.runInContext('renderResults()', context);
  assert.ok(rowPool.every((entry) => entry.button.disabled === false));
});

test('delegated copy ignores disabled buttons and still copies supported formats', () => {
  let click;
  let copied;
  const context = vm.createContext({
    currentResult: resultAt('-000001-01-01T00:00:00Z'), resultTab: 'dates',
    els: { resultsBody: { addEventListener(event, handler) { assert.equal(event, 'click'); click = handler; } } },
    copyText(text) { copied = text; }
  });
  vm.runInContext(section("      els.resultsBody.addEventListener('click'", '      els.resultTabs.forEach('), context);
  const button = { disabled: true, dataset: { rowIndex: '3' } };
  const event = { target: { closest() { return button; } } };
  click(event);
  assert.equal(copied, undefined);
  context.currentResult = buildResult(0n);
  button.disabled = false;
  click(event);
  assert.equal(copied, 'Thu, 01 Jan 1970 00:00:00 +0000');
});

for (const [iso, expectedCount] of [
  ['-000001-01-01T00:00:00Z', 7],
  ['0001-01-01T00:00:00Z', 8],
  ['1970-01-01T00:00:00Z', 9],
  ['+010000-01-01T00:00:00Z', 8]
]) {
  test(`copy all excludes unavailable formats at ${iso}`, () => {
    let click;
    let copied;
    const currentResult = resultAt(iso);
    const button = { addEventListener(event, handler) { assert.equal(event, 'click'); click = handler; } };
    vm.runInNewContext(section("      els.copyAll.addEventListener('click'", '      function showResult('), {
      currentResult, els: { copyAll: button },
      copyText(text, message, source) { copied = { text, message, source }; }
    });
    click();
    const expectedRows = [...currentResult.dates, ...currentResult.timestamps]
      .filter((row) => row.copyable !== false);
    assert.equal(copied.text.split('\n').length, expectedCount);
    assert.equal(copied.text, expectedRows.map((row) => `${row.label}: ${row.value}`).join('\n'));
    assert.match(copied.message, new RegExp(String(expectedCount)));
    assert.equal(copied.source, button);
  });
}

test('result tab arrow keys leave modified shortcuts to the browser', () => {
  const handlers = {};
  const tab = { dataset: { resultTab: 'dates' }, addEventListener(type, handler) { handlers[type] = handler; } };
  let focused = 0;
  const context = vm.createContext({
    resultTab: 'dates',
    els: { resultTabs: [tab], tabTimestamps: { focus() { focused += 1; } } },
    renderResults() {}
  });
  vm.runInContext(section('\n      els.resultTabs.forEach(', "      els.copyAll.addEventListener('click'"), context);
  const press = (modifiers) => {
    let prevented = false;
    handlers.keydown({ key: 'ArrowRight', ...modifiers, preventDefault() { prevented = true; } });
    return prevented;
  };
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
    assert.equal(press({ [modifier]: true }), false);
    assert.equal(context.resultTab, 'dates');
  }
  assert.equal(press({}), true);
  assert.equal(context.resultTab, 'timestamps');
  assert.equal(focused, 1);
});
