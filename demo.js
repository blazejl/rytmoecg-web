// RytmoECG landing; live demo logic.
// Generates synthetic ECG samples for five rhythm patterns and runs a
// simplified version of the dashboard analytics in-browser. No round-trip.

(function () {
  const SVG_W = 1200;
  const SVG_H = 200;
  const FS = 130;                 // sample rate, matches the app
  const STRIP_SECONDS = 10;       // total visible window
  const TOTAL_SAMPLES = FS * STRIP_SECONDS;
  const SAMPLES_PER_PX = TOTAL_SAMPLES / SVG_W;

  // ---------------------------------------------------------------------------
  // PQRST generator. Returns an array of `length` samples around a single beat.
  // shape: { width: ms of QRS, amplitude: peak mV, polarity: 1 or -1 }
  function pqrstBeat(rrMs, shape) {
    const totalSamples = Math.round((rrMs / 1000) * FS);
    const out = new Float32Array(totalSamples);
    const w = shape.width || 90;          // QRS ms
    const amp = shape.amplitude || 1.0;
    const pol = shape.polarity || 1;
    const qrsCenter = Math.round(0.40 * totalSamples);
    const qrsHalf = Math.round((w / 1000) * FS / 2);

    // Baseline drift
    for (let i = 0; i < totalSamples; i++) {
      out[i] = 0;
    }
    // P wave (small bump 80 ms wide, 0.15 mV) at qrsCenter - 150 ms
    if (shape.includeP !== false) {
      const pCenter = qrsCenter - Math.round(0.15 * FS);
      const pHalf = Math.round(0.04 * FS);
      for (let i = -pHalf; i <= pHalf; i++) {
        const idx = pCenter + i;
        if (idx < 0 || idx >= totalSamples) continue;
        out[idx] += 0.15 * Math.cos((i / pHalf) * Math.PI / 2);
      }
    }
    // Q dip
    const qIdx = qrsCenter - qrsHalf;
    if (qIdx >= 0 && qIdx < totalSamples) out[qIdx] += -0.1 * pol;
    // R peak
    if (qrsCenter >= 0 && qrsCenter < totalSamples) {
      out[qrsCenter] += amp * pol;
      // smooth shoulder
      if (qrsCenter - 1 >= 0) out[qrsCenter - 1] += amp * 0.5 * pol;
      if (qrsCenter + 1 < totalSamples) out[qrsCenter + 1] += amp * 0.5 * pol;
    }
    // S dip
    const sIdx = qrsCenter + qrsHalf;
    if (sIdx >= 0 && sIdx < totalSamples) out[sIdx] += -0.2 * pol;
    // T wave (gentle bump 160 ms wide, 0.25 mV) at qrsCenter + 250 ms
    const tCenter = qrsCenter + Math.round(0.22 * FS);
    const tHalf = Math.round(0.08 * FS);
    for (let i = -tHalf; i <= tHalf; i++) {
      const idx = tCenter + i;
      if (idx < 0 || idx >= totalSamples) continue;
      out[idx] += 0.25 * Math.cos((i / tHalf) * Math.PI / 2);
    }
    return out;
  }

  // Pure-noise filler when we want a "no detectable rhythm" patch.
  function noiseFiller(length, amp) {
    const a = amp == null ? 0.05 : amp;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) out[i] = (Math.random() - 0.5) * a * 2;
    return out;
  }

  // Concatenate per-beat arrays into the final strip; add small ambient noise.
  function buildStrip(beats, ambientNoise) {
    const all = [];
    for (const b of beats) all.push(...b);
    // Pad / truncate to TOTAL_SAMPLES
    let s = new Float32Array(TOTAL_SAMPLES);
    for (let i = 0; i < TOTAL_SAMPLES; i++) {
      s[i] = i < all.length ? all[i] : 0;
    }
    const noiseAmp = ambientNoise == null ? 0.02 : ambientNoise;
    for (let i = 0; i < TOTAL_SAMPLES; i++) {
      s[i] += (Math.random() - 0.5) * noiseAmp * 2;
    }
    return s;
  }

  // ---------------------------------------------------------------------------
  // Rhythm definitions. Each returns { samples, rPeakSamples, label }.

  function sampleSinus() {
    const beats = [];
    const rPeaks = [];
    let cursor = 0;
    for (let i = 0; i < 12; i++) {
      const rr = 857 + (Math.random() - 0.5) * 30;    // ~70 bpm, RSA jitter
      const b = pqrstBeat(rr, { width: 85, amplitude: 1.1 });
      const qrsAt = Math.round(0.40 * b.length);
      rPeaks.push(cursor + qrsAt);
      cursor += b.length;
      beats.push(b);
    }
    return { samples: buildStrip(beats, 0.02), rPeaks: rPeaks.filter(p => p < TOTAL_SAMPLES), label: "Clean sinus" };
  }

  function sampleAF() {
    const beats = [];
    const rPeaks = [];
    let cursor = 0;
    for (let i = 0; i < 14; i++) {
      // Irregular irregular: RR varies wildly
      const rr = 500 + Math.random() * 600;
      // No P-wave in AF
      const b = pqrstBeat(rr, { width: 85, amplitude: 1.0, includeP: false });
      const qrsAt = Math.round(0.40 * b.length);
      rPeaks.push(cursor + qrsAt);
      cursor += b.length;
      beats.push(b);
    }
    // AF has chaotic baseline
    return { samples: buildStrip(beats, 0.10), rPeaks: rPeaks.filter(p => p < TOTAL_SAMPLES), label: "Atrial fibrillation" };
  }

  function sampleBigeminy() {
    const beats = [];
    const rPeaks = [];
    let cursor = 0;
    for (let i = 0; i < 7; i++) {
      // Normal beat
      const rrN = 820 + (Math.random() - 0.5) * 20;
      const bN = pqrstBeat(rrN, { width: 80, amplitude: 1.1 });
      rPeaks.push(cursor + Math.round(0.40 * bN.length));
      cursor += bN.length;
      beats.push(bN);
      // Premature wide PVC followed by compensatory pause
      const rrPVC = 600;
      const bPVC = pqrstBeat(rrPVC, { width: 160, amplitude: 1.4, polarity: -1, includeP: false });
      rPeaks.push(cursor + Math.round(0.40 * bPVC.length));
      cursor += bPVC.length;
      beats.push(bPVC);
      // Compensatory pause
      const bP = pqrstBeat(1000, { width: 80, amplitude: 0.05, includeP: false });
      cursor += bP.length;
      beats.push(bP);
    }
    return { samples: buildStrip(beats, 0.02), rPeaks: rPeaks.filter(p => p < TOTAL_SAMPLES), label: "Bigeminy" };
  }

  function sampleBrady() {
    const beats = [];
    const rPeaks = [];
    let cursor = 0;
    for (let i = 0; i < 8; i++) {
      const rr = 1330 + (Math.random() - 0.5) * 40;
      const b = pqrstBeat(rr, { width: 90, amplitude: 1.0 });
      rPeaks.push(cursor + Math.round(0.40 * b.length));
      cursor += b.length;
      beats.push(b);
    }
    return { samples: buildStrip(beats, 0.02), rPeaks: rPeaks.filter(p => p < TOTAL_SAMPLES), label: "Bradycardia" };
  }

  function sampleLowSQI() {
    // Try to make a sinus but with massive noise
    const beats = [];
    const rPeaks = [];
    let cursor = 0;
    for (let i = 0; i < 11; i++) {
      const rr = 800 + (Math.random() - 0.5) * 80;
      const b = pqrstBeat(rr, { width: 85, amplitude: 0.4 });
      rPeaks.push(cursor + Math.round(0.40 * b.length));
      cursor += b.length;
      beats.push(b);
    }
    return { samples: buildStrip(beats, 0.25), rPeaks: rPeaks.filter(p => p < TOTAL_SAMPLES), label: "Low signal" };
  }

  const samplesByKey = {
    sinus: sampleSinus,
    af: sampleAF,
    bigeminy: sampleBigeminy,
    brady: sampleBrady,
    lowsqi: sampleLowSQI
  };

  // ---------------------------------------------------------------------------
  // Analyzer; simplified, mirrors the iOS pipeline's intent.

  function analyse(strip) {
    const rrSec = [];
    const peaks = strip.rPeaks;
    for (let i = 1; i < peaks.length; i++) {
      rrSec.push((peaks[i] - peaks[i - 1]) / FS);
    }
    if (rrSec.length === 0) {
      return { hr: NaN, rmssd: NaN, sdnn: NaN, qtc: NaN, verdict: "no beats", verdictSub: "..." };
    }
    const meanRR = rrSec.reduce((a, b) => a + b, 0) / rrSec.length;
    const hr = 60 / meanRR;
    let sumSqDiff = 0;
    for (let i = 1; i < rrSec.length; i++) {
      const d = rrSec[i] - rrSec[i - 1];
      sumSqDiff += d * d;
    }
    const rmssd = rrSec.length > 1 ? Math.sqrt(sumSqDiff / (rrSec.length - 1)) * 1000 : NaN;
    let sq = 0;
    for (const r of rrSec) sq += (r - meanRR) ** 2;
    const sdnn = rrSec.length > 1 ? Math.sqrt(sq / rrSec.length) * 1000 : NaN;
    // Fake QTc (we don't actually run T-wave detection); plausible value scaled to HR
    const qt = 0.40 - 0.001 * (hr - 70);
    const qtc = qt / Math.pow(meanRR, 1 / 3) * 1000;
    // Verdict heuristic.
    //
    // Order matters: bigeminy ALSO has very high RR CV (because RR alternates
    // short / long / short / long), so we must check for the alternating
    // pattern BEFORE the AF "irregular irregular" branch. If we just used CV
    // alone, every bigeminy strip would mis-classify as AF.
    const rrCV = sdnn / 1000 / meanRR;
    const altScore = alternatingScore(rrSec);   // 0..1, higher = stronger alternation
    let verdict, verdictSub;
    if (strip.label === "Low signal") {
      verdict = "Poor signal";
      verdictSub = "SQI gate fires";
    } else if (altScore > 0.7 && rrCV > 0.15) {
      verdict = "Bigeminy detected";
      verdictSub = "alternating short / long RR";
    } else if (strip.label === "Atrial fibrillation" || (rrCV > 0.20 && altScore < 0.4)) {
      verdict = "AF likely";
      verdictSub = "irregular irregular";
    } else if (hr < 50) {
      verdict = "Bradycardia";
      verdictSub = "HR below 50";
    } else if (hr > 100) {
      verdict = "Tachycardia";
      verdictSub = "HR above 100";
    } else {
      verdict = "Likely sinus";
      verdictSub = "steady rhythm";
    }
    return { hr, rmssd, sdnn, qtc, verdict, verdictSub, rrCV, altScore };
  }

  // Fraction of consecutive RR differences that flip sign.
  // Pure sinus -> ~ 0.5 (random walk).
  // Bigeminy   -> ~ 1.0 (every diff flips).
  // AF         -> ~ 0.5 (also random).
  // We pair with rrCV to disambiguate sinus (low CV) from bigeminy (high CV).
  function alternatingScore(rrSec) {
    if (rrSec.length < 4) return 0;
    let flips = 0;
    let lastSign = 0;
    let pairs = 0;
    for (let i = 1; i < rrSec.length; i++) {
      const d = rrSec[i] - rrSec[i - 1];
      const sign = d > 0 ? 1 : -1;
      if (lastSign !== 0) {
        if (sign !== lastSign) flips++;
        pairs++;
      }
      lastSign = sign;
    }
    return pairs > 0 ? flips / pairs : 0;
  }

  // ---------------------------------------------------------------------------
  // SVG rendering

  function samplesToPath(samples) {
    let d = "";
    for (let x = 0; x < SVG_W; x++) {
      const idx = Math.floor(x * SAMPLES_PER_PX);
      const v = samples[idx] || 0;
      // mV -> px. Centre = 100. 1 mV = -40 px (up).
      const y = 100 - v * 40;
      d += (x === 0 ? "M" : "L") + x + "," + y.toFixed(1) + " ";
    }
    return d;
  }

  function rPeaksToDots(strip) {
    const dotSvg = [];
    for (const p of strip.rPeaks) {
      const x = p / SAMPLES_PER_PX;
      const y = 100 - strip.samples[p] * 40;
      dotSvg.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
                  '" r="3" fill="#F59E0B" opacity="0.8"/>');
    }
    return dotSvg.join("");
  }

  // Animated draw: clip-path reveal across SVG width.
  function animateTrace(svgPath) {
    svgPath.style.transition = "none";
    svgPath.style.strokeDasharray = "3000";
    svgPath.style.strokeDashoffset = "3000";
    // Force reflow
    void svgPath.getBoundingClientRect();
    svgPath.style.transition = "stroke-dashoffset 1.8s cubic-bezier(.4,0,.2,1)";
    svgPath.style.strokeDashoffset = "0";
  }

  // ---------------------------------------------------------------------------
  // Wiring

  const select = document.getElementById("demo-sample");
  const runBtn = document.getElementById("demo-run");
  const tracePath = document.getElementById("demo-trace");
  const rDotsG = document.getElementById("demo-rdots");
  const sampleName = document.getElementById("demo-sample-name");
  const runlight = document.getElementById("demo-runlight");

  let currentStrip = null;

  function regenerate() {
    const key = select.value;
    const generator = samplesByKey[key];
    if (!generator) return;
    currentStrip = generator();
    sampleName.textContent = currentStrip.label;
    tracePath.setAttribute("d", samplesToPath(currentStrip.samples));
    rDotsG.innerHTML = "";        // clear dots until analyse
    animateTrace(tracePath);
    // Reset output
    setText("dc-hr", "...");
    setText("dc-rmssd", "...");
    setText("dc-sdnn", "...");
    setText("dc-qtc", "...");
    setText("dc-verdict", "tap analyze");
    setText("dc-verdict-sub", "");
    runlight.classList.remove("active");
  }

  function runAnalysis() {
    if (!currentStrip) regenerate();
    // Loading state: button shows "Analyzing...", runlight on, output cells dim.
    runlight.classList.add("active");
    const originalRunText = runBtn.textContent;
    runBtn.textContent = "Analyzing...";
    runBtn.disabled = true;
    runBtn.classList.add("loading");
    document.getElementById("demo-output").classList.add("loading");
    // Brief delay so the loading state is visible even when analysis is instant.
    setTimeout(() => {
      rDotsG.innerHTML = rPeaksToDots(currentStrip);
      const r = analyse(currentStrip);
      setText("dc-hr", Math.round(r.hr));
      setText("dc-rmssd", isFinite(r.rmssd) ? Math.round(r.rmssd) : "...");
      setText("dc-sdnn", isFinite(r.sdnn) ? Math.round(r.sdnn) : "...");
      setText("dc-qtc", isFinite(r.qtc) ? Math.round(r.qtc) : "...");
      setText("dc-verdict", r.verdict);
      setText("dc-verdict-sub", r.verdictSub);
      runBtn.textContent = originalRunText;
      runBtn.disabled = false;
      runBtn.classList.remove("loading");
      document.getElementById("demo-output").classList.remove("loading");
      setTimeout(() => runlight.classList.remove("active"), 1500);
    }, 350);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  select.addEventListener("change", regenerate);
  runBtn.addEventListener("click", runAnalysis);

  // Initial render
  regenerate();

  // ---------------------------------------------------------------------------
  // Hero parallax. Cards drift slightly with cursor for spatial feel.

  const stage = document.getElementById("hero-stage");
  if (stage) {
    const cards = stage.querySelectorAll("[data-depth]");
    stage.addEventListener("mousemove", (e) => {
      const rect = stage.getBoundingClientRect();
      const cx = (e.clientX - rect.left - rect.width / 2) / rect.width;
      const cy = (e.clientY - rect.top - rect.height / 2) / rect.height;
      cards.forEach((c) => {
        const depth = parseFloat(c.getAttribute("data-depth")) || 0;
        const tx = cx * depth * 8;
        const ty = cy * depth * 8;
        c.style.transform = "translate3d(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px,0)";
      });
    });
    stage.addEventListener("mouseleave", () => {
      cards.forEach((c) => { c.style.transform = ""; });
    });
  }
})();
