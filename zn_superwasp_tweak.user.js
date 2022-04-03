// ==UserScript==
// @name        Zooniverse SuperWASP tweak
// @namespace   astro.superwasp
// @match       https://www.zooniverse.org/projects/ajnorton/superwasp-variable-stars*
//              ^ the feature only works on talk pages (and classify page for mobile-tweak),
//                but we match the entire project to handle the cases that users traverse to talk via AJAX,
//                e.g., from Classify to Talk after users pressing Talk & Done.
// @grant       GM_setClipboard
// @grant       GM_addStyle
// @version     1.12.0
// @author      -
// @description UI 1) to help to follow up on a subject, looking up its information on SIMBAD, VSX, etc; and
//                 2) make Classify UI more friendly on mobile / tablets (reducing scrolls needed).
// @icon        https://wasp-planets.net/favicon.ico
// ==/UserScript==


// Generic helper
function isElementOrAncestor(el, criteria) {
  for (let elToTest = el; elToTest != null; elToTest = elToTest.parentElement) {
    if (criteria(elToTest)) {
      return true;
    }
  }
  return false;
}


//
//

function getSubjectFileName() {
  const btn = document.querySelector('button[title="Metadata"]');
  if (!btn) {
    return '';
  }

  btn.click();
  try {
    // the header filename can have different cases, depending on the specific subject
    const trFilename = Array.from(document.querySelectorAll('.modal-dialog table tr'))
                       .filter(tr => tr.querySelector('th').textContent.toLowerCase() === 'filename')[0];
    const fileName = trFilename ? trFilename.querySelector('td').textContent : null;
    if (fileName) {
      return fileName;
    }

    // new subjects no longer show filename, but contains links to VeSPA, which has SuperWASPId embedded
    // use it instead
    const trVeSPA = Array.from(document.querySelectorAll('.modal-dialog table tr'))
                       .filter(tr => tr.querySelector('th').textContent.toLowerCase() === 'vespa')[0];
    const [, waspId] = trVeSPA?.querySelector('td a')?.href?.match(/source[/]([^/]+)/) || [null, null];
    if (waspId) {
      return `${waspId}_Pn_fold.gif` // use the waspId to create a pseudo filename that the rest of the code expected.
    }
    return '';
  } finally {
    // if we press close right away without a timeout, it won't be closed in some cases
    // (possibly too soon for the UI to react?)
    setTimeout(() => document.querySelector('.modal-dialog button[title="Close"]').click(),
      10);
  }
}


function toCoordInDeg(ra1, ra2, ra3, dec1, dec2, dec3) {
  try {
    ra1 = parseInt(ra1, 10);
    ra2 = parseInt(ra2, 10);
    ra3 = parseFloat(ra3);

    dec1 = parseInt(dec1, 10);
    dec2 = parseInt(dec2, 10);
    dec3 = parseFloat(dec3);

    const ra = ra1 + (ra2 * 60 + ra3) / 3600;
    const dec = dec1 + (dec2 * 60 + dec3) / 3600;
    return [ra, dec];
  } catch (err) {
    console.error('toCoordInDeg(): unexpected error. The input: ', arguments, ' . Error:', err);
    return [-999, -999];
  }
}

function parseFileNameAsIds(fileName) {
  const match = fileName.match(/(^.+)J(\d+)(\d\d)(\d\d[.]\d*)([+-]\d+)(\d\d)(\d\d[.]\d*)_/);
  if (match) {
    const [, prefix, ra1, ra2, ra3, dec1, dec2, dec3] = match;
    const [ra_deg, dec_deg] = toCoordInDeg(ra1, ra2, ra3, dec1, dec2, dec3);
    return {
      'source_id': `${prefix} J${ra1}${ra2}${ra3}${dec1}${dec2}${dec3}`,
      'source_id_nospace': `${prefix}J${ra1}${ra2}${ra3}${dec1}${dec2}${dec3}`,
      'coord': `${ra1}:${ra2}:${ra3} ${dec1}:${dec2}:${dec3}`,
      'coord_deg': `${ra_deg.toFixed(5)} ${dec_deg.toFixed(5)}`,
      'ra': `${ra1}:${ra2}:${ra3}`,
      'dec': `${dec1}:${dec2}:${dec3}`,
      'ra_deg': ra_deg,
      'dec_deg': dec_deg,
    }
  } else {
    return null;
  }
}

/**
 * Convert SuperWASP flux (in micro-Vega) to magnitude.
 * @param {float} flux
 * @see https://exoplanetarchive.ipac.caltech.edu/docs/SuperWASPProcessing.html
 */
function fluxToMagnitude(flux) {
  return -2.5 * Math.log10(flux) + 15;
}


function showSubjectFollowUpUI() {
  if (!getSubjectFileName()) {
    return;
  }
  // else the page has the subject's filename, e.g., classify or subject talk,
  // so the UI would work, proceed.

  const ctr = document.getElementById('subjectFollowUpCtr');
  if (ctr) {
    ctr.style.display = 'block';
  } else {
    // else init the UI
    GM_addStyle(`
#subjectFollowUpCtr, #subjectFollowUpCtr * {
  -moz-user-select: none;
  user-select: none;
}

#subjectFollowUpCtr input {
  -moz-user-select: initial;
  user-select: initial;
}
`);
    document.body.insertAdjacentHTML('beforeend', `\
  <div id="subjectFollowUpCtr" style="position: fixed;top: 10px;right: 30px;border: 1px solid gray;background-color: rgba(225, 225, 225);z-index: 99999;padding: 0.5em 2ch;">
    <div accessKey="W" id="subjectFollowUpCloseCtl" style="float: right;margin-right: 6px; cursor: pointer; user-select: none;">[X]</div>
    <br>
    <input id="subjectFollowUpInFileName" size="38" placeholder="Filename" value=""> <button id="subjectFollowUpSubmitBtn">Convert</button><br>
    Coordinate / Source ID:<br>
    <input id="subjectFollowUpOutCoord" value="" readonly="">&emsp;<input id="subjectFollowUpOutCoordInDeg" value="" readonly=""><br>
    <input id="subjectFollowUpOutSourceId" value="" readonly=""><br>
    <a target="_vsx" href="https://www.aavso.org/vsx/index.php?view=search.top">VSX</a><br>
    <a target="_vespa" href="https://www.superwasp.org/vespa/">VESPA</a><br>
    <a target="_asas-sn" href="https://asas-sn.osu.edu/variables">ASAS-SN</a><br>
    <a target="_cerit" href="https://wasp.cerit-sc.cz/form">CERIT SuperWASP DR1 archive</a><br>
    <a target="_simbad" href="http://simbad.u-strasbg.fr/simbad/sim-fcoo">SIMBAD</a><br>
    <a target="_nasa_superwasp" href="https://exoplanetarchive.ipac.caltech.edu/cgi-bin/TblSearch/nph-tblSearchInit?app=ExoTbls&config=superwasptimeseries">NASA exoplanet SuperWASP TS archive</a><br>
    <details>
      <summary style="padding-top: 0.5em; margin-bottom: 0.5em;" accessKey="L">F<span style="text-decoration: underline;">l</span>ux to Magnitude</summary>
      Flux: <input id="subjectFollowUpInFlux" style="width: 10ch;"type="number">
      <button id="subjectFollowUpFluxToMagCtl" style="padding-left: 1.5ch;padding-right: 1.5ch;">Go</button>
      Mag.: <input id="subjectFollowUpOutMag" style="width: 10ch;" value="" tabindex="-1" readonly>
      <br>
      Flux: <input id="subjectFollowUpInFlux2" style="width: 10ch;"type="number">
      <button id="subjectFollowUpFluxToMagCtl2" style="padding-left: 1.5ch;padding-right: 1.5ch;">Go</button>
      Mag.: <input id="subjectFollowUpOutMag2" style="width: 10ch;" value="" tabindex="-1" readonly>
      <div title="mapping of selected flux to magnitude">
        2-> 14.25; 5-> 13.25 ; 10-> 12.5 ; 20-> 11.75<br>
        40-> 11 ; 80-> 10.25 ; 160-> 9.49
      </div>
    </details>
  </div>`); // various padding in html to make the controls easier to be tapped on mobile devices


    const doFluxToMagnitudeWithUI = (inElId, outElId) => {
      const flux = parseFloat(document.getElementById(inElId).value);
      const mag = fluxToMagnitude(flux);
      document.getElementById(outElId).value = mag.toFixed(2);
    };

    document.getElementById('subjectFollowUpFluxToMagCtl').onclick = () => {
      doFluxToMagnitudeWithUI('subjectFollowUpInFlux', 'subjectFollowUpOutMag');
    };

    document.getElementById('subjectFollowUpFluxToMagCtl2').onclick = () => {
      doFluxToMagnitudeWithUI('subjectFollowUpInFlux2', 'subjectFollowUpOutMag2');
    };

    document.getElementById('subjectFollowUpInFlux').onkeydown = (evt) => {
      if (evt.key == 'Enter') { // evt.code does not work for Firefox mobile. Use evt.key instead
        doFluxToMagnitudeWithUI('subjectFollowUpInFlux', 'subjectFollowUpOutMag');
      }
    };

    document.getElementById('subjectFollowUpInFlux2').onkeydown = (evt) => {
      if (evt.key == 'Enter') {
        doFluxToMagnitudeWithUI('subjectFollowUpInFlux2', 'subjectFollowUpOutMag2');
      }
    };

    document.getElementById('subjectFollowUpCloseCtl').onclick = () => {
      document.getElementById('subjectFollowUpCtr').style.display = 'none';
    };

    document.getElementById('subjectFollowUpSubmitBtn').onclick = () => {
      const ids = parseFileNameAsIds(document.getElementById('subjectFollowUpInFileName').value);
      if (!ids) {
        return;
      }
      // console.debug('ids: ', ids);
      const coord = ids.coord;
      document.getElementById('subjectFollowUpOutCoord').value = coord;
      GM_setClipboard(coord);
      document.getElementById('subjectFollowUpOutCoordInDeg').value = ids.coord_deg;

      document.querySelector('a[target="_vsx"]').href = `https://www.aavso.org/vsx/index.php?view=search.top#coord=${encodeURIComponent(coord)}`;
      document.querySelector('a[target="_vespa"]').href = `https://www.superwasp.org/vespa/source/${ids.source_id_nospace}/`;
      document.querySelector('a[target="_simbad"]').href = `http://simbad.u-strasbg.fr/simbad/sim-coo?Coord=${encodeURIComponent(coord)}` +
        '&CooFrame=FK5&CooEpoch=2000&CooEqui=2000&CooDefinedFrames=none&Radius=2&Radius.unit=arcmin&submit=submit+query&CoordList=';

      document.querySelector('a[target="_asas-sn"]').href = 'https://asas-sn.osu.edu/variables' +
        `?ra=${encodeURIComponent(ids['ra'])}&dec=${encodeURIComponent(ids['dec'])}&radius=2` +
        '&vmag_min=&vmag_max=&amplitude_min=&amplitude_max=&period_min=&period_max=&lksl_min=&lksl_max=&class_prob_min=&class_prob_max=' +
        '&parallax_over_err_min=&parallax_over_err_max=&name=&references[]=I&references[]=II&references[]=III&references[]=IV&references[]=V&references[]=VI' +
        '&sort_by=distance&sort_order=asc&show_non_periodic=true&show_without_class=true&asassn_discov_only=false&';

      document.getElementById('subjectFollowUpOutSourceId').value = ids.source_id;
      document.querySelector('a[target="_cerit"]').href = `https://wasp.cerit-sc.cz/klimes/?object=${encodeURIComponent(ids.source_id)}`;
    }; // ()'subjectFollowUpSubmitBtn').onclick = ...

    document.getElementById('subjectFollowUpOutCoord').onclick = (evt) => { evt.target.select(); };
    document.getElementById('subjectFollowUpOutSourceId').onclick = (evt) => { evt.target.select(); };

    // add a listener to auto-close the pop-in if users clicks outside of it
    window.addEventListener('click', (evt) => {
      if (!isElementOrAncestor(evt.target, el => {
          return ['showSubjectFollowUpUIBtn', 'subjectFollowUpCtr'].includes(el.id) || // ignore when it's clicked related to the pop-in
            (el.tagName === 'BUTTON' && el.title === 'Metadata') || el.classList.contains('modal-dialog'); // also ignore when metadata button (because the pop-in logic clicks it)
      })) {
        document.getElementById('subjectFollowUpCtr').style.display = 'none';
      }
      return true;
    }, {passive: true});
  }

  // init the UI with the given data
  document.getElementById('subjectFollowUpOutCoord').value = '';
  document.getElementById('subjectFollowUpOutCoordInDeg').value = '';
  document.getElementById('subjectFollowUpOutSourceId').value = '';
  document.getElementById('subjectFollowUpInFileName').value = getSubjectFileName();
  for (let elId of ['subjectFollowUpInFlux', 'subjectFollowUpOutMag', 'subjectFollowUpInFlux2', 'subjectFollowUpOutMag2']) {
    document.getElementById(elId).value = '';
  }

  document.getElementById('subjectFollowUpSubmitBtn').click();

  document.querySelector('a[target="_vsx"]').focus();
}


function initShowSubjectFollowUpUI() {
  // set the container with z-index: 1 so that over pop-in-like UI, e.g., Profile dropdown menu and Field Guide
  // can be seen above the button
  // Fortunately it is still clickable over the header with z-index: 1
  document.body.insertAdjacentHTML('beforeend', `\
<div style="position: fixed;
            top: 70px;
            right: -2px;
            z-index: 1;
            transform: rotate(-90deg) translateX(50%);
            transform-origin: right bottom;
            ">
  <button accesskey="T" id="showSubjectFollowUpUIBtn" title="Follow Up on a subject on Talk page" style="
    padding: 0.2em 1.5ch;
    font-weight: bold;
    font-size: 1.05em;
"><u>T</u>o follow-up</button>
</div>`);
  document.getElementById('showSubjectFollowUpUIBtn').onclick = showSubjectFollowUpUI;
}

initShowSubjectFollowUpUI();


//
//

const autoScrollDownWhenClassifyLoaded = () => {
  // try to scroll to classify UI. Hopefully the UI is updated enough after 1 second for it to work.
  let done = false;
  const doScrollDown = () => {
    if (done) {
      return;
    }
    const elAnchor = document.querySelector('.subject-viewer .svg-subject image');
    if (elAnchor) {
      elAnchor.scrollIntoView();
      done = true;
    } else {
      console.warn('autoScrollDownWhenClassifyLoaded() - cannot find classify UI element. No-OP.');
    }
  }
  setTimeout(doScrollDown, 1000); // desktop browsers tend to load the image fairly fast
  setTimeout(doScrollDown, 2000);
  setTimeout(doScrollDown, 4000);
  setTimeout(doScrollDown, 6000); // mobile browsers tend to take a while to get to load the image
  setTimeout(doScrollDown, 8000);
};

function addShortCutToClassifyLink() {
  const closeNavMenuIfNeeded = () => {
    // - when the window is narrow, the top nav menu (About, Classify, Talk, etc.) is a drop down
    // - when the Classify sub-menu is clicked via shortcut, it is opened automatically
    // - we want to have it closed so that it wont' obstruct the UI
    setTimeout(() => {
      const navMenuBtn = document.querySelector('h1 + button.open');
      if (navMenuBtn) { navMenuBtn.click(); }
    }, 100);
  };

  const classifyLink = document.querySelector('a[href="/projects/ajnorton/superwasp-variable-stars/classify"]');
  if (classifyLink) {
    classifyLink.accessKey = "C";
    classifyLink.onclick = () => {
      autoScrollDownWhenClassifyLoaded();
      closeNavMenuIfNeeded();
      return true; // let the click continue
    }
  }
}
// try multiple times, as the classify link won't be there until relevant ajax load completes.
setTimeout(addShortCutToClassifyLink, 1000);
setTimeout(addShortCutToClassifyLink, 4000);
setTimeout(addShortCutToClassifyLink, 8000);


/**
 * To reduce the need to scroll to the top to get back to classify
 */
function addClassifyButton() {
  GM_addStyle(`\
  /* a new classify button, reducing clicks to get there from menu */
  #classifyCtl {
    top: 50vh; /* make it below the field guide pullout button */
  }
`);

  function addClassifyLinkToPullOut() {
    const ctr = document.querySelector('.pullout-content');
    if (!ctr) {
      console.debug('addClassifyLinkToPullOut() - pullout container UI not there yet. No-op.')
      return false;
    }

    if (document.getElementById('classifyCtl')) {
      return true; /* it has been created, no need to redo */
    }
    // create a Classify button that looks like Field Guide pullout, but is a link (that can be clicked to spawn in a new tab)
    ctr.insertAdjacentHTML('beforeend', `
<button id="classifyCtl" type="button" class="field-guide-pullout-toggle">
  <a href="/projects/ajnorton/superwasp-variable-stars/classify"
      style="color: inherit !important; text-decoration: none;">
    <strong><span>Classify</span></strong>
  </a>
</button>`);
    document.querySelector('#classifyCtl a').onclick = () => {
      if (location.pathname === '/projects/ajnorton/superwasp-variable-stars/classify') {
        // block the click as it's already on Classify UI
        return false;
      } else {
        const classifyMenuBtn = document.querySelector('a[href="/projects/ajnorton/superwasp-variable-stars/classify"][accesskey="C"]');
        if (classifyMenuBtn) {
          // The button uses ajax to load, and supports auto scroll to classify UI
          classifyMenuBtn.click();
          return false;
        }
        console.warn('Classify Button at pullout: cannot find Classify Menu Button. Load the page normally. Auto scroll down would not work');
        return true;
      }
    };
    return true;
  }
  // try a few time until it succeeds (after the dependent field guide pullout UI is populated in ajax calls)
  setTimeout(addClassifyLinkToPullOut, 500);
  setTimeout(addClassifyLinkToPullOut, 1000);
  setTimeout(addClassifyLinkToPullOut, 2000);
  setTimeout(addClassifyLinkToPullOut, 4000);
  setTimeout(addClassifyLinkToPullOut, 10000);
}
addClassifyButton();

//
//

function tweakForMobile() {
  GM_addStyle(`\
  @media (max-width: 900px) {
    /* UI tweaks for phones/ tablets.
       900px width is the threshold of SuperWASP's built-in style that will show
       the UI in 1-column mode, i.e., the task pane is below the lightcurve.
     */

    /* make field guide wider on narrow screen */
    .field-guide-pullout {
      width: 60vw;
    }

    /* Reduce task pane vertical space to reduce scrolling.
       With the tweaks, on tablets, the lightcurve and the task pane will likely
       to be able to fit on the screen without scrolling.
     */

    /* make answers to have 2 items in a row */
    .workflow-task .answers {
      display: flex;
      flex-wrap: wrap;
    }

    .workflow-task .answers > .answer {
      flex: 0 48%;
      margin-left: 1%;
      margin-right: 1%;
    }

    /* The TASK / TUTORIAL buttons */
    .subject-viewer + div > div:first-of-type {
        display: none;
    }

    /* The question above the answers  */
    .workflow-task .question > * {
      display: none;
    }

    .workflow-task .question  {
      height: 1em;
    }

    /* Need help with this task? button below the answer */
    .workflow-task > button {
      display: none;
    }

  }
  `);
}
tweakForMobile();



