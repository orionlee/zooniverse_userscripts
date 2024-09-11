// ==UserScript==
// @name        Zooniverse Generic Subject External Information
// @namespace   astro.tess
// @match       https://www.zooniverse.org/projects/vbkostov/eclipsing-binary-patrol*
// @match       https://www.zooniverse.org/projects/gaia-zooniverse/gaia-vari*
// @grant       GM_openInTab
// @grant       GM_setClipboard
// @version     1.4
// @author      -
// @description
// @icon        https://panoptes-uploads.zooniverse.org/project_avatar/7a23bfaf-b1b6-4561-9156-1767264163fe.jpeg
// ==/UserScript==


function clickInfoBtn() {
  const infoBtn = document.querySelector('button[title="Metadata"]');
  if (infoBtn) {
    infoBtn.click();
    return true;
  }
  console.warn("Cannot find Info Button. No-Op;")

  return false;
} // function clickInfoBtn()


function hideMetadataPopIn() {
  document.querySelector('.modal-dialog-close-button')?.click();
}


const keyMap = {
  "KeyI":    clickInfoBtn,
  "Numpad1": clickInfoBtn,
  "!altKey": {"KeyI": clickInfoBtn},
  "!any-modifier": {},
}


//
// The following generic code is copied from Planet Hunter TESS Tweaks userjs
//
function handleViewerKeyboardShortcuts(evt) {
  if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(evt.target.tagName) && !evt.altKey) {
    // user typing in an input box or focuses on a button, do nothing, unless alt is used
    return;
  }

  const handler =(() => {
    const hasAnyModifier = evt.altKey || evt.shiftKey || evt.ctrlKey || evt.metaKey;
    if (!hasAnyModifier) {
      return keyMap[evt.code];
    }

    let res = null;
    if (evt.altKey && !evt.shiftKey && !evt.ctrlKey && !evt.metaKey) {
      res = keyMap['!altKey'][evt.code];
    }

    if (res == null) {
      res = keyMap['!any-modifier'][evt.code];
    }
    return res;
  })();

  if (handler) {
    const success = handler();
    if (success) {
      evt.preventDefault();
    }
  }

}
window.addEventListener('keydown', handleViewerKeyboardShortcuts);


//
// Ctrl Double Click TICID in Metadata Popin spawns ExoFOP page
//



function getMetaData(name) {
  let row = null;
  document.querySelectorAll('.modal-dialog table tbody > tr').forEach(tr => {
    if (tr.querySelector('th')?.textContent === name) {
      row = tr;
    }
  });
  return row?.querySelector('td')?.textContent;
}


function message(msg, showDurationMillis=3000) {
  document.body.insertAdjacentHTML('beforeend', `
<div id="msgCtr" style="position: fixed;right: 4px;bottom: 10vh;background-color: rgba(255, 255, 0, 0.6);z-index: 9999;">
${msg}
</div>
`);
  setTimeout(() => { document.getElementById('msgCtr')?.remove(); }, showDurationMillis);
}


// Per project level config
const projectConfigs = {
  "/projects/vbkostov/eclipsing-binary-patrol": {
    'headerName': 'TIC_ID',
    'urlFunc': (tic) => `https://exofop.ipac.caltech.edu/tess/target.php?id=${tic}#open=_gaia-dr3-var|_gaia-dr3|_tce|_gaia-dr3-xmatch-var|_tess-eb|_asas-sn|simbad|_vsx`,
  },

  "/projects/gaia-zooniverse/gaia-vari" : {
    'headerName': 'sourceid',
    'urlFunc': (source) => `https://exofop.ipac.caltech.edu/tess/target.php?id=Gaia DR3 ${source}#open=_gaia-dr3-xmatch-var|_asas-sn|simbad|_vsx|_gaia-dr3-var|_gaia-dr3`,
  },
}


function getCurrentConfig() {
  for (const projPath in projectConfigs) {
    if (location.pathname.startsWith(projPath)) {
      return projectConfigs[projPath];
    }
  }
  return null;
}


function copyHeaderValueToClipboard(headerName, notifyUser=true) {
  const text = getMetaData(headerName);
  GM_setClipboard(text);
  if (notifyUser) {
    message(`${text}<br>copied.`);
  }
  return text;
}


function onDblClickToSpawnExternalURL(evt) {
  const curCfg = getCurrentConfig();
  if (!curCfg) {
    console.debug("onDblClickToSpawnExternalURL(): not applicable to current project. No-op");
    return;
  }

  if (evt.ctrlKey && evt.shiftKey) { // Ctrl-Shift dbl click to copy the id and spawn external URL
    clickInfoBtn();
    const id = getMetaData(curCfg['headerName']);
    const externalURL = curCfg['urlFunc'](id);
    GM_openInTab(externalURL, true); // in background
    copyHeaderValueToClipboard(curCfg['headerName']);
    hideMetadataPopIn();
  }

  if (!(evt.target.tagName === 'TD' && evt.target.previousElementSibling?.textContent === curCfg['headerName'])) {
    return;
  }

  // case on relevant header cell (usually some ID of the subject, e.g. TIC for TESS)
  if (!(evt.ctrlKey || evt.shiftKey || evt.altKey)) {
    copyHeaderValueToClipboard(curCfg['headerName']);
    return;
  }
  // case also with Ctrl / shift / AltKey
  const id = getMetaData(curCfg['headerName']);
  const externalURL = curCfg['urlFunc'](id);
  GM_openInTab(externalURL, true); // in background
  copyHeaderValueToClipboard(curCfg['headerName']);
}
document.addEventListener('dblclick', onDblClickToSpawnExternalURL);
