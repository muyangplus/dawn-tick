(function () {
  if (window.__dtImportReady) {
    return;
  }
  window.__dtImportReady = true;

  var MAX_PAYLOAD = 1500000;

  // 页面导入协议：字段名与计数口径与 `packages/core/src/import/page-tables.ts` 的
  // `PAGE_DIAGNOSTICS_FIELDS` / `PageDiagnostics`、以及书签 `PAGE_BOOKMARKLET` 逐字一致。
  // 本文件由 Rust `include_str!` 注入（`apps/desktop/src-tauri/src/lib.rs` 的 IMPORT_INJECTION），
  // 读不到 TS 模块，所以字段名只能各写一份：改字段或计数规则时三处一起改，
  // `apps/web/test/import-injection.test.ts` 用共用样例逐项断言两端输出相同。
  var DIAGNOSTICS_VERSION = 2; // 必须等于 page-tables.ts 的 BOOKMARKLET_VERSION
  var KB_TABLE_PATTERN = /kbtable|^kb|timetable|skb|kbgrid/i;
  var GRID_CELL_PATTERN = /^\d{1,2}[-_]\d{1,2}$/;
  var LOADING_PATTERN = /加载中|loading/i;

  var collect = function () {
    var parts = [];
    var seen = new Set();
    // 字段顺序与 PAGE_DIAGNOSTICS_FIELDS 相同：v, url, title, frames, tables, kbTables, gridCells, ready, loading
    var info = {
      v: DIAGNOSTICS_VERSION,
      url: location.href,
      title: document.title,
      frames: 0,
      tables: 0,
      kbTables: 0,
      gridCells: 0,
      ready: document.readyState,
      loading: false,
    };
    var walk = function (doc, depth) {
      if (!doc || depth > 2 || seen.has(doc)) {
        return;
      }
      seen.add(doc);
      // frames 与书签一致：按访问到的文档数计，outerHTML 读取失败也算一段
      info.frames += 1;
      try {
        parts.push(doc.documentElement.outerHTML);
      } catch (error) {}
      try {
        var tables = doc.querySelectorAll('table');
        info.tables += tables.length;
        for (var i = 0; i < tables.length; i += 1) {
          var table = tables[i];
          if (KB_TABLE_PATTERN.test((table.id || '') + (table.className || ''))) {
            info.kbTables += 1;
          }
        }
      } catch (error) {}
      try {
        var nodes = doc.querySelectorAll('[id]');
        for (var j = 0; j < nodes.length; j += 1) {
          if (GRID_CELL_PATTERN.test(nodes[j].id)) {
            info.gridCells += 1;
          }
        }
      } catch (error) {}
      try {
        if (doc.body && LOADING_PATTERN.test(doc.body.textContent || '')) {
          info.loading = true;
        }
      } catch (error) {}
      var frames = [];
      try {
        frames = Array.prototype.slice.call(doc.querySelectorAll('iframe,frame'));
      } catch (error) {}
      frames.forEach(function (frame) {
        try {
          walk(frame.contentDocument, depth + 1);
        } catch (error) {}
      });
    };
    walk(document, 0);
    return '<<<DAWNTICK>>>' + JSON.stringify(info) + '<<<FRAME>>>' + parts.join('<<<FRAME>>>') + '<<<END>>>';
  };

  // 内容放进应用自身页面的片段里，不发任何网络请求，也不占用本机端口。
  // 用 URL 安全 base64：片段里的 + 会被解析成空格，必须替换掉。
  var targetUrl = function (payload) {
    var bytes = new TextEncoder().encode(payload);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    var data = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return 'http://tauri.localhost/import-submit.html#d=' + data;
  };

  var go = function (url) {
    window.location.href = url;
  };

  var showFallback = function (payload) {
    var previous = document.getElementById('dt-import-fallback');
    if (previous) {
      previous.remove();
    }
    var panel = document.createElement('div');
    panel.id = 'dt-import-fallback';
    panel.style.cssText =
      'position:fixed;right:18px;bottom:78px;z-index:2147483647;width:420px;max-width:80vw;padding:12px;border-radius:12px;background:#fff;color:#141414;box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:13px;line-height:1.5';
    var title = document.createElement('div');
    title.textContent = '页面太大或带不过来，请全选下面的内容复制，回到晓刻粘贴导入';
    var box = document.createElement('textarea');
    box.value = payload;
    box.style.cssText = 'width:100%;height:120px;margin-top:8px;font-size:11px';
    box.onclick = function () {
      box.select();
    };
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.style.cssText = 'margin-top:8px;padding:6px 12px;border:1px solid #ccc;border-radius:8px;background:#f5f5f5;cursor:pointer';
    close.onclick = function () {
      panel.remove();
    };
    panel.appendChild(title);
    panel.appendChild(box);
    panel.appendChild(close);
    document.body.appendChild(panel);
  };

  var mount = function () {
    if (!document.body || document.getElementById('dt-import-button')) {
      return;
    }
    var button = document.createElement('button');
    button.id = 'dt-import-button';
    button.type = 'button';
    button.textContent = '导入到晓刻';
    button.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:12px 20px;border:0;border-radius:999px;background:#ff6b4a;color:#141414;font-size:15px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer';
    button.onclick = function () {
      button.textContent = '正在读取课表…';
      var payload;
      try {
        payload = collect();
      } catch (error) {
        button.textContent = '读取失败，请重试';
        return;
      }
      if (payload.length > MAX_PAYLOAD) {
        showFallback(payload);
        button.textContent = '请手动复制';
        return;
      }
      try {
        var submit = window.__dtImportSubmit || go;
        submit(targetUrl(payload));
        button.textContent = '已交给晓刻';
      } catch (error) {
        showFallback(payload);
        button.textContent = '请手动复制';
      }
    };
    document.body.appendChild(button);
  };

  if (document.readyState === 'loading' && !document.body) {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
