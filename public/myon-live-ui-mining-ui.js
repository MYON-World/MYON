/* DEV-only Rion display: mining placeholder, no folders or classification. */
(function () {
'use strict';
if(new URLSearchParams(location.search).get('server')!=='dev')return;
const style=document.createElement('style');
style.textContent=[
 '.mw-root.mw-mining-wide{width:100%;max-width:none}',
 '.mw-mining-panel{box-sizing:border-box;width:100%;border:1px solid #3b607b;border-radius:9px;background:linear-gradient(150deg,#10263a,#0b1c2c);padding:16px 18px;color:#e5f5ff}',
 '.mw-mining-panel h2{font-size:18px;line-height:1.5;font-weight:700;margin:0}',
 '@media(max-width:740px){.mw-mining-panel{padding:13px}.mw-mining-panel h2{font-size:16px}}'
].join('\n');
document.head.append(style);
function render(view){
 view.replaceChildren();
 const panel=document.createElement('section');
 panel.className='mw-mining-panel';
 const name=document.createElement('h2');
 name.textContent='채광 리온';
 panel.append(name);
 view.append(panel);
}
window.MYON_DEV_MINING_UI=Object.freeze({render});
})();
