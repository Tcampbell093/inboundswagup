const navButtons=document.querySelectorAll('.nav-btn');
const pages=document.querySelectorAll('.page');

function activatePage(pageId,{updateHash=true,persist=true}={}){
  if(!pageId) return;
  const targetPage=document.getElementById(pageId);
  if(!targetPage) return;
  navButtons.forEach(btn=>btn.classList.remove('active'));
  pages.forEach(page=>page.classList.remove('active'));
  targetPage.classList.add('active');
  const targetBtn=[...navButtons].find(btn=>btn.dataset.page===pageId);
  if(targetBtn) targetBtn.classList.add('active');
  if(persist){
    localStorage.setItem('ops_hub_active_page',pageId);
  }
  if(updateHash && window.location.hash!==`#${pageId}`){
    history.replaceState(null,'',`#${pageId}`);
  }
}

navButtons.forEach(btn=>btn.addEventListener('click',()=>activatePage(btn.dataset.page)));

function restoreActivePage(){
  const hashPage=window.location.hash.replace('#','').trim();
  const savedPage=localStorage.getItem('ops_hub_active_page');
  const defaultPage=document.querySelector('.nav-btn.active')?.dataset.page||'homePage';
  activatePage(hashPage||savedPage||defaultPage,{updateHash:!!(hashPage||savedPage),persist:true});
}

window.goToPage=activatePage;
