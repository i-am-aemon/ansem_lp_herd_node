import { layout, esc } from './layout.js';

/**
 * Locked gate — password entry is in the header top-right.
 */
export function renderUnlock({ error = '', next = '/', passwordConfigured = true } = {}) {
  return layout({
    title: 'Locked',
    active: '/unlock',
    unlocked: false,
    body: `
      <div style="max-width:28em;margin:48px auto 0">
        <h1 style="margin:0 0 8px">Locked</h1>
        <p class="muted" style="margin:0 0 18px;font-size:11px;line-height:1.5">
          ${
            passwordConfigured
              ? `Enter <code>DASHBOARD_PASSWORD</code> in the <strong>top right</strong> (from <code>.env</code> or Railway Variables), then hit the unlock icon.`
              : `No <code>DASHBOARD_PASSWORD</code> set — open. Add one in <code>.env</code> / Railway Variables before a public deploy.`
          }
        </p>
        ${error ? `<p class="bad" style="margin:0 0 12px">${esc(error)}</p>` : ''}
        <p class="muted" style="margin:0;font-size:10px">Next: <code>${esc(next || '/')}</code></p>
        <input type="hidden" id="unlock-next" value="${esc(next || '/')}" />
      </div>
      <script>
        (function () {
          var nextEl = document.getElementById('unlock-next');
          var form = document.getElementById('hdr-unlock-form');
          if (form && nextEl) {
            form.addEventListener('submit', function () {
              /* header script reads ?next= ; keep URL in sync */
            }, true);
          }
          var inp = document.getElementById('hdr-password');
          if (inp) inp.focus();
        })();
      </script>
    `,
  });
}
