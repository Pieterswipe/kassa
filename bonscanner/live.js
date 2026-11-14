// Kopie uit Pieterswipe/bon-scanner commit 9453c04 (proto/live.js), verder ongewijzigd.
/* Live OMR. Only fresh video frames vote. A successful read returns an editable order. */
(function (global) {
  'use strict';

  function cameraContext() {
    let policy = 'unknown';
    try {
      const api = document.permissionsPolicy || document.featurePolicy;
      // Some engines return false even for directives they do not implement.
      if (typeof api?.allowsFeature === 'function' &&
          (typeof api.features !== 'function' || api.features().includes('camera'))) {
        policy = api.allowsFeature('camera') ? 'allowed' : 'blocked';
      }
    } catch (_) {}
    return {
      origin: global.location?.origin || 'unknown',
      frame: !global.top ? 'unknown' : global.top === global ? 'top-level' : 'iframe',
      secure: typeof global.isSecureContext === 'boolean' ? global.isSecureContext : null,
      policy,
      permission: 'unknown'
    };
  }

  async function permissionState() {
    // Query only after a failed request. On some mobile browsers "camera" is
    // unsupported. A slow, advisory diagnostics query must not block the UI.
    let timer;
    try {
      const api = global.navigator?.permissions;
      if (!api?.query) return 'unknown';
      const result = await Promise.race([
        api.query({ name: 'camera' }),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 700); })
      ]);
      return ['denied', 'granted', 'prompt'].includes(result?.state) ? result.state : 'unknown';
    } catch (_) { return 'unknown'; }
    finally { clearTimeout(timer); }
  }

  function cameraMessage(details) {
    if (details.errorName === 'PolicyBlocked') {
      return details.frame === 'iframe'
        ? 'Deze ingebedde weergave blokkeert de camera. Open de scanner rechtstreeks in een nieuw browsertabblad.'
        : 'Het toegangsbeleid van deze pagina blokkeert de camera. De scanner moet via een pagina worden geopend die cameragebruik toestaat.';
    }
    switch (details.errorName) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        if (details.frame === 'iframe') return 'Deze ingebedde weergave krijgt geen camerabeeld. Open de scanner rechtstreeks in een nieuw browsertabblad.';
        if (details.permission === 'granted') {
          return 'De browser meldt dat cameratoegang is toegestaan, maar krijgt geen beeld. Controleer de cameratoegang voor je browser in de instellingen van je toestel.';
        }
        if (details.permission === 'denied') {
          return 'De browser meldt dat cameratoegang voor deze pagina is geblokkeerd. Controleer de toestemming bij dit webadres en de cameratoegang voor je browser op je toestel.';
        }
        return 'De camera-aanvraag is geweigerd. Controleer de cameratoegang voor dit webadres én voor de browser op je toestel. Gebruik je een ingebouwde appbrowser, open de link dan rechtstreeks in Chrome of Safari.';
      case 'SecurityError':
        return 'De browser heeft de camera voor deze pagina uitgeschakeld. Open de scanner rechtstreeks in Chrome of Safari en controleer de cameratoegang op je toestel.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'De browser vindt geen beschikbare camera. Controleer of je toestel een werkende camera heeft.';
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'De camera kan geen bruikbare videostand openen. Probeer de scanner op een andere camera.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'De browser kan de camera niet starten. Sluit eventuele andere camera-apps en controleer of je toestel de camera voor de browser beschikbaar stelt.';
      case 'AbortError':
        return 'Het starten van de camera werd onderbroken. Sluit andere camera-apps en probeer opnieuw.';
      case 'InvalidStateError':
        return 'Maak dit tabblad actief en start de camera opnieuw.';
      default:
        return 'De browser kon de camera niet openen. Bekijk de diagnose voor de gemelde fout.';
    }
  }

  function primeAudio() {
    const Audio = global.AudioContext || global.webkitAudioContext;
    if (!Audio) return null;
    try {
      const audio = new Audio();
      // Resume during the tap so the later recognition tone can play on mobile.
      if (audio.state !== 'running') audio.resume().catch(() => {});
      return audio;
    } catch (_) { return null; }
  }

  function closeAudio(audio) {
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
  }

  function signal(audio) {
    try { global.navigator?.vibrate?.(90); } catch (_) {}
    if (!audio) return;
    try {
      if (audio.state !== 'running') { closeAudio(audio); return; }
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      const now = audio.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(740, now);
      oscillator.frequency.setValueAtTime(990, now + 0.08);
      volume.gain.setValueAtTime(0.001, now);
      volume.gain.exponentialRampToValueAtTime(0.13, now + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      oscillator.connect(volume);
      volume.connect(audio.destination);
      oscillator.onended = () => closeAudio(audio);
      oscillator.start(now);
      oscillator.stop(now + 0.21);
      // A phone may suspend audio between scheduling the tone and onended.
      setTimeout(() => closeAudio(audio), 650);
    } catch (_) { closeAudio(audio); }
  }

  function classify(result) {
    const incomplete = result.rows.filter(row => row.quantity === null);
    const hasInk = result.rows.some(row => row.status === 'marked' || row.status === 'ambiguous'
      || row.scores.some(score => score >= 0.065));
    if (!hasInk) {
      return { hint: incomplete.length ? 'Houd de bon stil en zoek gelijkmatig licht.' : 'De bon is leeg. Toon een ingevulde bestelbon.' };
    }
    if (incomplete.length > 2) return { hint: 'Houd de bon vlak en dichter bij de camera.' };
    const key = result.template + '|' + result.rows.map(row => row.quantity === null
      ? row.status + ':' + row.candidates.join(',') : String(row.quantity)).join('|');
    return { key, review: incomplete.length > 0 };
  }

  function steadyPosition(before, after) {
    if (!before || !after) return false;
    const diagonal = Math.hypot(after[2].x - after[0].x, after[2].y - after[0].y);
    return after.every((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y) < diagonal * 0.07);
  }

  const zoneIds = ['TL', 'TR', 'BL', 'BR'];
  const zoneNames = { TL: 'linksboven', TR: 'rechtsboven', BL: 'linksonder', BR: 'rechtsonder' };
  const clearFrames = 3, reviewFrames = 5, continuityMs = 1300;

  function zoneReading(row) {
    if (row.unreadable?.length) return '';
    if (Number.isInteger(row.quantity) && row.quantity >= 0 && row.quantity <= 6) return 'n' + row.quantity;
    const marks = row.inkCandidates || [];
    return marks.length ? 'i' + marks.join(',') : '';
  }

  function compatiblePosition(before, after) {
    const span = corners => Math.hypot(corners[2].x - corners[0].x, corners[2].y - corners[0].y);
    const oldSpan = span(before), newSpan = span(after);
    const ratio = newSpan / oldSpan;
    if (ratio < 0.64 || ratio > 1.56) return false;
    // All four labelled corners must move continuously even when only one zone
    // is left in the viewfinder. Sharing an ID alone cannot link two receipts.
    const allowance = 0.46 * Math.max(oldSpan, newSpan);
    return after.every((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y) < allowance);
  }

  function consecutiveView(previous, zones, canvas, begin, frameId) {
    if (canvas.width !== previous.width || canvas.height !== previous.height ||
      frameId <= previous.frameId || begin - previous.finishedAt > continuityMs) return false;
    const common = zones.filter(zone => previous.corners.has(zone.id));
    return common.length > 0 && common.every(zone => compatiblePosition(previous.corners.get(zone.id), zone.corners));
  }

  function viewOf(zones, canvas, frameId) {
    return { corners: new Map(zones.map(z => [z.id, z.corners])), width: canvas.width,
      height: canvas.height, frameId, finishedAt: performance.now() };
  }

  function paperEvidence(track, zones, partial, continuousOverview) {
    const conflicts = [];
    let matchingMarks = 0, matchingRows = 0;
    for (const zone of zones.concat(partial)) {
      const direct = zones.includes(zone);
      zone.rows.forEach((row, i) => {
        const index = zone.indices[i], vote = track.votes[index];
        const key = zoneReading(row);
        if (!vote?.ready || !key) return;
        if (vote.key === key) {
          if (direct || !vote.directReady) matchingRows++;
          if (direct && vote.directReady && key !== 'n0') matchingMarks++;
          return;
        }
        // After a true interruption, recovered rows may corroborate their own
        // saved readings or veto a rejoin. They never authenticate signed rows.
        if (!direct && (continuousOverview || track.locked.has(zone.id))) return;
        // An unresolved double is compatible with either of its printed marks.
        // A temporarily ambiguous camera view also cannot contradict a clear
        // stored quantity which is one of its candidates.
        const priorMarks = vote.row.quantity === null ? vote.row.inkCandidates : [vote.row.quantity];
        const newMarks = row.quantity === null ? row.inkCandidates : [row.quantity];
        if (!priorMarks.some(n => newMarks.includes(n))) conflicts.push({ index, key, zone, i,
          hard: vote.directReady || !continuousOverview });
      });
    }
    // An inferred row is supplemental. Only an uninterrupted signed overview
    // can correct it without going through the normal sheet-change guard.
    const hard = conflicts.filter(c => c.hard || !matchingMarks);
    return { matchingMarks, matchingRows, conflicts: hard,
      conflictKey: hard.map(c => c.index + ':' + c.key).sort().join('|') };
  }

  function copyFrame(canvas) {
    const saved = document.createElement('canvas');
    saved.width = canvas.width;
    saved.height = canvas.height;
    saved.getContext('2d').drawImage(canvas, 0, 0);
    return saved;
  }

  // Retain a small, upright source strip for a review row that may leave the
  // camera view. Its six original bubbles are in printed quantity order.
  function saveReviewStrip(canvas, points) {
    if (!points || points.length !== 6) return null;
    const size = 44, strip = document.createElement('canvas');
    strip.width = size * points.length;
    strip.height = size;
    const context = strip.getContext('2d');
    if (!context || typeof context.clip !== 'function') return null;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, strip.width, size);
    points.forEach((p, i) => {
      const left = points[Math.max(0, i - 1)], right = points[Math.min(points.length - 1, i + 1)];
      const dx = right.x - left.x, dy = right.y - left.y;
      const spacing = Math.hypot(dx, dy) / (i === 0 || i === points.length - 1 ? 1 : 2);
      if (spacing <= 0) return;
      context.save();
      context.beginPath();
      context.rect(i * size, 0, size, size);
      context.clip();
      context.translate((i + 0.5) * size, 0.5 * size);
      context.scale(size / spacing, size / spacing);
      context.rotate(-Math.atan2(dy, dx));
      context.drawImage(canvas, p.x - spacing, p.y - spacing, 2 * spacing, 2 * spacing,
        -spacing, -spacing, 2 * spacing, 2 * spacing);
      context.restore();
    });
    return strip;
  }

  function rowImageQuality(row, points) {
    return { row, missing: row.unreadable?.length || 0,
      span: Math.hypot(points[5].x - points[0].x, points[5].y - points[0].y) };
  }

  function improvesRowImage(current, previous) {
    return !previous || current.missing < previous.missing ||
      current.missing === previous.missing && current.span > previous.span * 1.20;
  }

  function keepRowDetail(track, index, quality, canvas, points) {
    if (!improvesRowImage(quality, track.details[index])) return;
    const strip = saveReviewStrip(canvas, points);
    if (strip) track.details[index] = { ...quality, strip };
  }

  function updateZoneVotes(track, zones, directIds, canvas, savedOverview) {
    for (const zone of zones) {
      const direct = directIds.includes(zone.id);
      if (!direct && track.locked.has(zone.id)) continue;
      for (const [i, row] of zone.rows.entries()) {
        const index = zone.indices[i];
        track.seenUnreadable[index] = Boolean(row.unreadable?.length);
        const key = zoneReading(row);
        let vote = track.votes[index];
        const dispute = track.disputed.get(index);
        if (dispute) {
          dispute.matches = direct && key && key === vote?.key ? dispute.matches + 1 : 0;
          if (dispute.matches >= clearFrames) track.disputed.delete(index);
        }
        // A completed zone keeps its clear quantities and any review evidence.
        // Only an unanswered double may be refined, after three fresh clear
        // readings of one of its original candidates.
        if (track.locked.has(zone.id)) {
          if (vote.row.quantity !== null) continue;
          const canResolve = key && row.quantity > 0 && vote.row.inkCandidates.includes(row.quantity);
          if (!canResolve) { delete vote.refinement; continue; }
          const count = vote.refinement?.key === key ? vote.refinement.count + 1 : 1;
          if (count >= clearFrames) track.votes[index] = { key, streak: count, ready: true, directReady: true, row };
          else vote.refinement = { key, count };
          continue;
        }
        // Losing a row to the pen or leaving the frame does not undo it. A
        // visible mark in a different bubble, even alongside covered bubbles,
        // does require a fresh decision before charging or discarding the row.
        if (vote?.ready && key !== vote.key) {
          const prior = vote.row.quantity === null ? vote.row.inkCandidates : [vote.row.quantity];
          if (!key && !row.inkCandidates?.some(q => !prior.includes(q))) continue;
          const points = zone.centers[i], strip = saveReviewStrip(canvas, points);
          if (strip) track.details[index] = { ...rowImageQuality(row, points), strip };
        }
        if (!key) { track.votes[index] = null; continue; }
        if (!vote || vote.key !== key) {
          vote = { key, streak: 0, directStreak: 0, ready: false, directReady: false, row };
          track.votes[index] = vote;
        }
        const needed = row.quantity === null ? reviewFrames : clearFrames;
        if (vote.streak < needed) vote.streak++;
        vote.ready = vote.streak >= needed;
        if (!vote.directReady) {
          vote.directStreak = direct ? vote.directStreak + 1 : 0;
          vote.directReady = vote.directStreak >= needed;
        }
        vote.row = row;
      }
      if (direct && zone.indices.every(index => track.votes[index]?.directReady && !track.disputed.has(index))) {
        track.locked.add(zone.id);
      }
      // Keep source pixels only for rows that may still require a decision.
      // The saved full overview supplies these for free in the ordinary case.
      for (const [i, index] of zone.indices.entries()) {
        const vote = track.votes[index], row = zone.rows[i];
        if (vote?.ready && vote.row.quantity !== null) continue;
        if (vote?.ready && !vote.strip && zoneReading(row) === vote.key) {
          vote.strip = saveReviewStrip(canvas, zone.centers[i]);
        }
        if (savedOverview || vote?.strip) continue;
        const points = zone.centers[i];
        if (points?.length !== 6) continue;
        const quality = rowImageQuality(row, points);
        if (improvesRowImage(quality, track.overviewEvidence[index])) keepRowDetail(track, index, quality, canvas, points);
      }
    }
  }

  function newZoneTrack(layout) {
    return { zones: layout.map(z => ({ id: z.id, indices: z.indices.slice() })),
      votes: [], locked: new Set(), overview: null, overviewQuality: -1, overviewCenters: [],
      seenUnreadable: [], details: [], overviewEvidence: [], disputed: new Map(),
      frames: 0, last: null, missed: 0, longGap: false, conflict: null, recovery: null, held: null };
  }

  function breakStreaks(track) {
    for (let i = 0; i < track.votes.length; i++) {
      const vote = track.votes[i];
      if (vote?.ready) {
        delete vote.refinement;
        if (!vote.directReady) vote.directStreak = 0;
      } else if (vote) track.votes[i] = null;
    }
    for (const dispute of track.disputed.values()) dispute.matches = 0;
  }

  function zoneProgress(track, visible = []) {
    const done = [], review = [];
    let questions = 0, largest = 0, mostUncertain = null;
    for (const zone of track?.zones || []) {
      if (!track.locked.has(zone.id)) continue;
      done.push(zone.id);
      const count = zone.indices.filter(i => track.votes[i].row.quantity === null).length;
      if (count) review.push(zone.id);
      questions += count;
      if (count > largest) { largest = count; mostUncertain = zone.id; }
    }
    const manual = done.length === 4 && questions > 2;
    const target = manual ? mostUncertain : track?.frames >= clearFrames ? zoneIds.find(id => !done.includes(id)) || null : null;
    const canFinishPartial = done.length > 0 && (done.length < zoneIds.length || manual);
    return { active: true, done, review, visible, target, manual, canFinishPartial, questions, recovery: track?.recovery || null };
  }

  function zonedOrder(track, partial = false) {
    const rows = [];
    for (const zone of track.zones) {
      for (const index of zone.indices) {
        const vote = track.votes[index];
        const dispute = track.disputed.get(index);
        let row;
        if (vote?.ready && !dispute) {
          row = vote.row;
        } else {
          const seen = track.seenUnreadable[index];
          const manualReason = dispute ? 'unstable' : seen === undefined ? 'unseen' : seen ? 'unreadable' : 'unstable';
          const observed = dispute?.row || track.details[index]?.row || track.overviewEvidence[index]?.row || vote?.row;
          const ink = observed?.inkCandidates || [];
          row = { quantity: null, status: 'uncertain', inkCandidates: ink, candidates: ink,
            unreadable: observed?.unreadable || [], scores: observed?.scores || [], manualReason };
        }
        if (row.quantity === null) {
          const strip = dispute?.strip || vote?.strip || track.details[index]?.strip;
          if (strip) row = { ...row, reviewCrop: strip.toDataURL('image/png') };
        }
        rows[index] = row;
      }
    }
    return { result: { ok: true, template: 'Z50', rows, centers: track.overviewCenters, reason: '', partial },
      canvas: track.overview, review: rows.some(row => row.quantity === null) };
  }

  function recoveryHint(recovery) {
    return recovery === 'different-sheet'
      ? 'De aantallen komen niet overeen met de bewaarde bon. Toon die bon volledig of kies Nieuwe bon.'
      : 'Is dit nog dezelfde bon? Toon het volledige blad of bevestig om verder te scannen.';
  }

  function scanZones(session, result, canvas, begin, frameId) {
    const zones = result.zones, visible = zones.map(z => z.id);
    const full = zoneIds.every(id => visible.includes(id));
    const verifiedOverview = full || (visible.length === 3 && result.overviewEstablished === true);
    const partial = verifiedOverview ? (result.partialZones || []).filter(zone =>
      zoneIds.includes(zone.id) && !visible.includes(zone.id)) : [];
    let track = session.zoneTrack;
    if (track) {
      const continuous = consecutiveView(track.last, zones, canvas, begin, frameId);
      const continuousOverview = continuous && verifiedOverview && !track.missed && !track.longGap && !track.recovery;
      const { conflictKey, conflicts, matchingMarks, matchingRows } = paperEvidence(track, zones, partial, continuousOverview);
      const readyCount = track.votes.reduce((n, vote) => n + Number(Boolean(vote?.ready)), 0);
      const recent = begin - track.last.finishedAt <= continuityMs;
      if (conflictKey) {
        // A stable conflicting overview can come from persistent glare too.
        // Keep a real order locked until the operator explicitly starts another.
        const previous = track.conflict;
        const count = previous?.key === conflictKey && previous.overview === verifiedOverview &&
          consecutiveView(previous.view, zones, canvas, begin, frameId) ? previous.count + 1 : 1;
        track.conflict = { key: conflictKey, count, overview: verifiedOverview, view: viewOf(zones, canvas, frameId) };
        track.held = null;
        breakStreaks(track);
        // The sheet guard still holds all votes. If the uninterrupted view
        // contradicts only unfinished rows, manual handoff must flag those
        // rows rather than presenting a potentially stale zero or quantity.
        if (continuousOverview && conflicts.every(c => !track.locked.has(c.zone.id))) {
          for (const { index, key, zone, i } of conflicts) {
            if (track.disputed.get(index)?.key === key) continue;
            track.disputed.set(index, { key, matches: 0, row: zone.rows[i], strip: saveReviewStrip(canvas, zone.centers[i]) });
          }
        }
        const wasBlank = track.locked.size === 4 && track.votes.every(vote => vote.row.quantity === 0);
        if (wasBlank && count >= clearFrames && verifiedOverview) track = session.zoneTrack = null;
        else {
          if (count >= clearFrames) track.recovery = 'different-sheet';
          const progress = zoneProgress(track, visible);
          // A potential contradiction cannot be approved into this order.
          if (progress.recovery === 'same-sheet') progress.recovery = null;
          return { progress, hint: track.recovery === 'different-sheet' ? recoveryHint('different-sheet') :
            'Houd de bon even stil. De bewaarde zones blijven vastgelegd.' };
        }
      } else {
        track.conflict = null;
        // Local IDs identify a printed quadrant, not a unique paper copy.
        // A retained marked row can bridge a short focus/zoom interruption.
        // After a long interruption, automatically rejoin only if the overview
        // independently reproduces *every* ready row. A covered old difference
        // must not pass because a different slip happens to share one drink.
        const overviewMatches = verifiedOverview && matchingRows === readyCount && track.votes.some(vote => vote?.directReady);
        const shortLink = recent && !track.longGap && !track.recovery &&
          (continuous && matchingMarks > 0 || !track.missed && matchingMarks >= 2);
        const linked = overviewMatches || shortLink || (!track.recovery && !track.missed && continuous);
        if (!linked) {
          if (!readyCount) track = session.zoneTrack = null;
          else {
            breakStreaks(track);
            track.recovery ||= 'same-sheet';
            track.held = track.recovery === 'same-sheet' ? viewOf(zones, canvas, frameId) : null;
            return { progress: zoneProgress(track, visible), hint: recoveryHint(track.recovery) };
          }
        }
      }
    }
    if (!track) {
      const layout = global.ZoneBonForm?.zones || (full ? zones : null);
      if (!verifiedOverview || !layout) return { progress: zoneProgress(null, visible), hint: 'Toon eerst de volledige vierzonebon.' };
      track = session.zoneTrack = newZoneTrack(layout);
    }
    track.missed = 0;
    track.longGap = false;
    track.recovery = track.held = null;
    // Read the supplementary strips only after the signed zones have
    // authenticated this view. They never supply camera corners or zone IDs.
    const observations = zones.concat(partial);
    // Keep the best complete source image and coordinates together. An order
    // assembled on a close-up must still show a correctly aligned full receipt.
    let savedOverview = false;
    if (verifiedOverview) {
      const quality = observations.reduce((sum, zone) => sum + zone.rows.filter(row => row.quantity !== null).length, zones.length);
      if (quality > track.overviewQuality) {
        const nextCenters = [], nextEvidence = [];
        for (const zone of observations) zone.indices.forEach((index, i) => {
          const points = zone.centers[i];
          if (points?.length !== 6) return;
          nextCenters[index] = points;
          const quality = rowImageQuality(zone.rows[i], points);
          nextEvidence[index] = quality;
          if (track.details[index] && improvesRowImage(quality, track.details[index])) track.details[index] = null;
        });
        // When a better overview loses sight of an earlier row, keep its last
        // useful strip without retaining the entire old frame.
        track.overviewEvidence.forEach((previous, index) => {
          const vote = track.votes[index];
          if (vote?.ready && (vote.strip || vote.row.quantity !== null)) return;
          if (improvesRowImage(previous, nextEvidence[index])) {
            keepRowDetail(track, index, previous, track.overview, track.overviewCenters[index]);
          }
        });
        track.overview = copyFrame(canvas);
        track.overviewCenters = nextCenters;
        track.overviewEvidence = nextEvidence;
        track.overviewQuality = quality;
        savedOverview = true;
      }
    }
    updateZoneVotes(track, observations, visible, canvas, savedOverview);
    track.elapsed = Math.round(performance.now() - begin);
    track.frames++;
    track.last = viewOf(zones, canvas, frameId);
    const progress = zoneProgress(track, visible);
    if (progress.done.length < zoneIds.length) {
      if (!progress.target) return { progress, hint: 'Houd de volledige bon even stil.' };
      const target = zones.find(z => z.id === progress.target);
      const clear = target && target.rows.every(row => zoneReading(row));
      const hint = clear ? 'Houd ' + zoneNames[progress.target] + ' even stil.'
        : 'Breng het blok ' + zoneNames[progress.target] + ' langzaam dichterbij. Vermijd de weerspiegeling.';
      return { progress, hint };
    }
    if (progress.manual) {
      return { progress, hint: 'Breng het blok ' + zoneNames[progress.target] +
        ' dichterbij. Of kies ‘De rest manueel’ om de ' + progress.questions + ' vragen te controleren.' };
    }
    if (!track.votes.some(vote => vote.row.quantity > 0 || vote.row.quantity === null)) {
      return { progress, hint: 'De bon is leeg. Toon een ingevulde bestelbon.' };
    }
    return { progress, order: zonedOrder(track) };
  }

  function createLiveBonScanner({ video, onStatus, onDetected, onError, onCancel, onPlaybackRequired, onZones }) {
    let active = null;

    function status(session, text) {
      if (text !== session.hint) {
        session.hint = text;
        onStatus(text);
      }
    }

    function publishZones(session, state) {
      if (!onZones) return;
      const key = JSON.stringify(state);
      if (key !== session.progressKey) {
        session.progressKey = key;
        onZones(state);
      }
    }

    function release(session, withSignal = false) {
      if (session !== active) return;
      active = null;
      session.zoneTrack = null;
      if (session.progressKey) publishZones(session, { active: false, done: [], review: [], target: null, visible: [], canFinishPartial: false });
      global.scanForm?.releaseBuffers?.();
      clearTimeout(session.timer);
      clearTimeout(session.watchdog);
      if (session.callback != null) video.cancelVideoFrameCallback?.(session.callback);
      document.removeEventListener('visibilitychange', session.hide);
      global.removeEventListener('pagehide', session.pagehide);
      video.removeEventListener('error', session.lost);
      if (session.stream) {
        for (const track of session.stream.getTracks()) {
          track.removeEventListener('ended', session.lost);
          track.stop();
        }
        if (video.srcObject === session.stream) {
          video.pause();
          video.srcObject = null;
        }
      }
      if (withSignal) signal(session.audio);
      else closeAudio(session.audio);
    }

    function continueSameBon() {
      const session = active, track = session?.zoneTrack;
      if (track?.recovery !== 'same-sheet' || !track.held || performance.now() - track.held.finishedAt > continuityMs) return;
      // Bind the operator's choice to what the camera currently sees. The next
      // frame still has to fit that view before its readings get a vote.
      track.last = track.held;
      track.missed = 0;
      track.longGap = false;
      track.held = track.recovery = null;
      publishZones(session, zoneProgress(track, [...track.last.corners.keys()]));
      status(session, 'De zones zijn bewaard. Houd de bon even stil.');
    }

    function newBon() {
      if (!active) return;
      active.zoneTrack = active.key = null;
      active.matches = 0;
      publishZones(active, zoneProgress(null));
      status(active, 'Toon de nieuwe bestelbon volledig in het camerabeeld.');
    }

    function finishPartial() {
      const session = active, track = session?.zoneTrack;
      if (!track || !zoneProgress(track).canFinishPartial) return false;
      const order = zonedOrder(track, true);
      release(session);
      onDetected({ ...order, elapsed: track.elapsed });
      return true;
    }

    function stop() {
      if (active) release(active);
    }

    function fail(session, text, stage, errorName) {
      if (active !== session) return;
      release(session);
      onError(text, { ...session.context, stage, errorName });
    }

    function checkCameraAlive(session) {
      clearTimeout(session.watchdog);
      session.watchdog = setTimeout(() => fail(session, 'Het camerabeeld staat stil. Open de camera opnieuw.', 'stream', 'FrameTimeout'), 12000);
    }

    function schedule(session, delay) {
      if (active !== session) return;
      session.timer = setTimeout(() => {
        if (active !== session) return;
        if (typeof video.requestVideoFrameCallback === 'function') {
          session.callback = video.requestVideoFrameCallback((_, meta) => {
            session.callback = null;
            capture(session, meta.presentedFrames ?? meta.mediaTime);
          });
        } else {
          const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
          capture(session, frames > 0 ? frames : video.currentTime);
        }
      }, delay);
    }

    function capture(session, frameId) {
      if (active !== session) return;
      if (!video.videoWidth || !video.videoHeight || video.readyState < 2
        || !Number.isFinite(frameId) || frameId <= session.lastFrame) {
        schedule(session, 125);
        return;
      }
      session.lastFrame = frameId;
      checkCameraAlive(session);
      try {
        const { canvas, ctx } = session;
        const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const pixels = ctx.getImageData(0, 0, w, h);
        const begin = performance.now();
        const result = global.scanForm(pixels);
        const elapsed = Math.round(performance.now() - begin);
        if (result.ok && result.template === 'Z50') {
          session.matches = 0;
          session.key = null;
          const observation = scanZones(session, result, canvas, begin, frameId);
          publishZones(session, observation.progress);
          if (active !== session) return;
          if (observation.order) {
            release(session, true);
            onDetected({ ...observation.order, elapsed });
            return;
          }
          status(session, observation.hint);
          schedule(session, 60);
          return;
        }
        const track = session.zoneTrack;
        if (track) {
          if (!track.missed) breakStreaks(track);
          track.missed++;
          // A named template here identifies mixed Z50 sheets or a legacy
          // form, a stronger break than a single featureless autofocus frame.
          if (result.template || track.missed >= 3 || begin - track.last.finishedAt > continuityMs) track.longGap = true;
          track.held = track.conflict = null;
          const progress = zoneProgress(track);
          // No positive view to confirm while the lens is between zones.
          progress.recovery = null;
          publishZones(session, progress);
        } else if (session.progressKey) {
          publishZones(session, { active: false, done: [], review: [], target: null, visible: [], canFinishPartial: false });
        }
        const read = result.ok ? classify(result) : { hint: result.hint || 'Toon de volledige bestelbon in het camerabeeld.' };
        if (!read.key) {
          session.matches = 0;
          session.key = null;
          let hint = read.hint;
          if (track?.locked.size && !result.ok) {
            hint = result.template ? (result.hint || result.reason) + ' Je zones zijn bewaard.' :
              'Je zones zijn bewaard. Richt de camera op ' + (zoneNames[zoneProgress(track).target] || 'de bon') + '.';
          }
          status(session, hint);
        } else {
          const same = read.key === session.key && steadyPosition(session.corners, result.corners);
          session.matches = same ? session.matches + 1 : 1;
          session.key = read.key;
          session.corners = result.corners;
          if (session.matches >= (read.review ? 4 : 3)) {
            release(session, true);
            onDetected({ result, canvas, elapsed, review: read.review });
            return;
          }
          status(session, 'Bon gevonden. Houd hem even stil…');
        }
        schedule(session, 145);
      } catch (error) {
        fail(session, 'Het camerabeeld kon niet worden gelezen. Open de camera opnieuw.', 'analysis', error.name || 'FrameReadError');
      }
    }

    async function activateVideo(session, manual) {
      session.awaitingPlayback = false;
      checkCameraAlive(session);
      try {
        await video.play();
      } catch (error) {
        if (active !== session) return;
        if (error.name === 'NotAllowedError' && !manual && onPlaybackRequired) {
          // Keep the granted stream while the operator activates video playback.
          clearTimeout(session.watchdog);
          session.awaitingPlayback = true;
          session.watchdog = setTimeout(() => fail(session,
            'Het camerabeeld is niet gestart. Tik op Start camera om opnieuw te beginnen.',
            'playback', 'PlaybackTimeout'), 60000);
          status(session, 'De camera is geopend. Tik op Start camerabeeld om de video te tonen.');
          onPlaybackRequired();
          return;
        }
        fail(session, 'De camera is geopend, maar de browser kon het livebeeld niet afspelen. Open de scanner in een apart tabblad en probeer opnieuw.',
          'playback', error.name || 'PlaybackError');
        return;
      }
      if (active !== session) return;
      session.canvas = document.createElement('canvas');
      session.ctx = session.canvas.getContext('2d', { willReadFrequently: true });
      if (!session.ctx) {
        fail(session, 'Deze browser kan het camerabeeld niet verwerken.', 'analysis', 'CanvasUnavailable');
        return;
      }
      status(session, 'Toon de volledige bestelbon in het camerabeeld.');
      schedule(session, 0);
    }

    function resumePlayback() {
      if (active?.awaitingPlayback) return activateVideo(active, true);
    }

    async function start() {
      stop();
      const devices = global.navigator?.mediaDevices;
      const context = cameraContext();
      let issue;
      if (context.secure === false) {
        issue = ['InsecureContext', 'Deze pagina is geopend via een onbeveiligde verbinding. Open de scanner via de HTTPS-link.'];
      } else if (context.policy === 'blocked') {
        issue = ['PolicyBlocked', cameraMessage({ ...context, errorName: 'PolicyBlocked' })];
      } else if (typeof devices?.getUserMedia !== 'function') {
        issue = ['CameraApiUnavailable', 'Deze browserweergave biedt geen livecamera. Open de HTTPS-link in een gewoon tabblad van Chrome of Safari.'];
      }
      if (issue) {
        onError(issue[1], { ...context, stage: 'context', errorName: issue[0] });
        return;
      }
      const session = { audio: primeAudio(), matches: 0, context };
      active = session;
      session.pagehide = () => {
        if (active !== session) return;
        release(session);
        onCancel();
      };
      session.hide = () => { if (document.hidden) session.pagehide(); };
      session.lost = event => fail(session, 'De verbinding met de camera werd onderbroken. Open de camera opnieuw.',
        'stream', event?.type === 'error' ? 'VideoError' : 'TrackEnded');
      document.addEventListener('visibilitychange', session.hide);
      global.addEventListener('pagehide', session.pagehide);
      video.addEventListener('error', session.lost);
      status(session, 'Camera openen…');
      let stream;
      try {
        try {
          stream = await devices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          });
        } catch (error) {
          if (active !== session) return;
          // Retry a device-format failure only, using the camera's defaults.
          if (!['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error.name)) throw error;
          stream = await devices.getUserMedia({ video: true, audio: false });
        }
      } catch (error) {
        if (active !== session) return;
        const name = error.name || 'CameraRequestError';
        if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)) {
          session.context.permission = await permissionState();
        }
        const currentPolicy = cameraContext().policy;
        session.context.policy = currentPolicy;
        const text = cameraMessage({ ...session.context, errorName: currentPolicy === 'blocked' ? 'PolicyBlocked' : name });
        fail(session, text, 'request', name);
        return;
      }

      // A browser permission dialog can resolve after the operator has cancelled.
      if (active !== session) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      session.stream = stream;
      const tracks = stream.getVideoTracks();
      if (!tracks.length || tracks.every(track => track.readyState === 'ended')) {
        fail(session, 'Er is geen actief camerabeeld. Open de camera opnieuw.', 'stream', 'NoActiveTrack');
        return;
      }
      tracks.forEach(track => track.addEventListener('ended', session.lost));
      try {
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await activateVideo(session, false);
      } catch (error) {
        fail(session, 'De browser kon het geopende camerabeeld niet tonen.', 'stream', error.name || 'VideoSetupError');
      }
    }

    return { start, stop, resumePlayback, continueSameBon, newBon, finishPartial };
  }

  global.createLiveBonScanner = createLiveBonScanner;
})(window);
