// Related Dossiers - ProIdeaStore
(function () {
  fetch('/registry.json')
    .then((response) => response.json())
    .then((data) => {
      const dossiers = (data.dossiers || []).slice(0, 3);
      if (!dossiers.length) return;

      const bar = document.createElement('aside');
      bar.id = 'related-dossiers';
      bar.innerHTML = `
        <style>
          #related-dossiers{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;gap:.5rem;align-items:center;overflow-x:auto;border-top:1px solid #e4e7ec;background:#fff;padding:.65rem 1rem;font-family:Manrope,system-ui,sans-serif}
          #related-dossiers strong{color:#667085;font-size:.72rem;text-transform:uppercase}
          #related-dossiers a{border:1px solid #e4e7ec;border-radius:8px;color:#101018;padding:.42rem .65rem;text-decoration:none;white-space:nowrap;font-size:.78rem;font-weight:800}
        </style>
        <strong>Related</strong>
        ${dossiers.map((dossier) => `<a href="/dossiers/${dossier.id}/">${dossier.name}</a>`).join('')}
      `;
      document.body.appendChild(bar);
    })
    .catch(() => {});
})();
