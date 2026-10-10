(function () {
  if (window.__dtImportReady) {
    return;
  }
  window.__dtImportReady = true;

  var collect = function () {
    var parts = [];
    var seen = new Set();
    var walk = function (doc, depth) {
      if (!doc || depth > 2 || seen.has(doc)) {
        return;
      }
      seen.add(doc);
      try {
        parts.push(doc.documentElement.outerHTML);
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
    var info = { v: 2, url: location.href, title: document.title, frames: parts.length };
    return '<<<DAWNTICK>>>' + JSON.stringify(info) + '<<<FRAME>>>' + parts.join('<<<FRAME>>>') + '<<<END>>>';
  };

  var send = function (payload) {
    return fetch('http://dtimport.localhost/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
    });
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
    title.textContent = '自动回传被页面策略拦截，请全选下面的内容复制，回到晓刻粘贴导入';
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
      send(payload)
        .then(function (response) {
          button.textContent = response.ok ? '已发送到晓刻' : '发送失败，请重试';
        })
        .catch(function () {
          showFallback(payload);
          button.textContent = '请手动复制';
        })
        .then(function () {
          setTimeout(function () {
            button.textContent = '导入到晓刻';
          }, 3000);
        });
    };
    document.body.appendChild(button);
  };

  if (document.readyState === 'loading' && !document.body) {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
