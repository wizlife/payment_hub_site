/* Cloudflare's public site token is an identifier, not an account credential. */
(() => {
  'use strict';
  const key = 'payment-hub-analytics-disabled';
  const button = document.getElementById('analytics-toggle');
  let disabled = true;
  let storageAvailable = false;
  try {
    disabled = localStorage.getItem(key) === '1';
    storageAvailable = true;
  } catch (_) { /* If preferences cannot be read, do not collect. */ }
  if (button) {
    button.hidden = false;
    button.textContent = storageAvailable
      ? (disabled ? '이 브라우저 통계 참여 켜기' : '내 방문 통계에서 제외')
      : '저장소 사용 불가: 방문 통계 제외 중';
    button.disabled = !storageAvailable;
    button.addEventListener('click', () => {
      try {
        localStorage.setItem(key, disabled ? '0' : '1');
        // Reload without the beacon when opting out. Past visits remain counted.
        location.reload();
      } catch (_) {
        button.textContent = '설정을 저장하지 못했습니다';
      }
    });
  }
  if (disabled || navigator.webdriver || location.protocol !== 'https:' ||
      location.hostname !== 'wizlife.github.io' ||
      !location.pathname.startsWith('/payment_hub_site/')) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.dataset.cfBeacon = JSON.stringify({ token: 'cf0127f031b641a89c730cef1a482741', spa: false });
  document.body.appendChild(script);
})();
