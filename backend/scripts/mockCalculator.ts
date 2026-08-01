/**
 * A stand-in for calc.apacrs.org, close enough in shape to exercise the
 * automation offline: the same field labels, the tabbed layout with results
 * on the "Universal Formula" tab, the linked Lens Factor / A Constant pair,
 * and — the reason this exists — the site's "Enter Data and Calculate" →
 * "View Formula" switch once a calculation finishes.
 *
 * It is a test fixture, not a model of the formula: the powers it returns
 * are made up. Run it with `npm run mock`, then point a run at it with
 * BARRETT_URL=http://127.0.0.1:4100/.
 */
import { createServer } from "node:http";

/** How long the mock pretends to compute, so the readiness wait is real. */
const CALC_DELAY_MS = Number(process.env.MOCK_CALC_DELAY_MS ?? 800);

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Barrett Universal II Formula (mock)</title></head>
<body>
  <div id="tabs">
    <a href="#" onclick="showTab('data')">Patient Data</a>
    <a href="#" onclick="showTab('formula')">Universal Formula</a>
  </div>

  <div id="data">
    <button type="button" onclick="calculate()">Calculate</button>
    <button type="button">Reset Form</button>
    <span id="mode">Enter Data and Calculate</span>

    <div>K Index 1.3375 <input type="radio" name="k" value="1.3375" checked>
         K Index 1.332 <input type="radio" name="k" value="1.332"></div>

    <!-- The site lays these out as table cells: label in its own cell, the
         input in the next one. -->
    <table>
      <tr><td>Doctor Name</td><td><input type="text"></td>
          <td>Patient Name</td><td><input type="text" id="patient"></td>
          <td>Patient ID</td><td><input type="text"></td></tr>
      <tr><td>Lens Factor</td><td><input type="text" id="lf" value="1.57" oninput="deriveA()"></td>
          <td>(-2.0~5.0) or A Constant</td><td><input type="text" id="ac" value="118.4" oninput="deriveLf()"></td>
          <td>(112~125)</td>
          <td><select id="lens" onchange="applyLens()">
            <option value="pc">Personal Constant</option>
            <option value="sn60wf">Alcon SN60WF</option>
            <option value="sn6atx">Alcon SN6ATx</option>
          </select></td></tr>
    </table>

    <!-- Like the site: every row repeats its label once per eye column,
         OD's input before OS's in document order. -->
    <table>
      <tr><th></th><th>OD</th><th></th><th>OS</th></tr>
      <tr><td>Axial Length</td><td><input id="al_r"></td><td>Axial Length</td><td><input id="al_l"></td></tr>
      <tr><td>Measured K1</td><td><input id="k1_r"></td><td>Measured K1</td><td><input id="k1_l"></td></tr>
      <tr><td>Measured K2</td><td><input id="k2_r"></td><td>Measured K2</td><td><input id="k2_l"></td></tr>
      <tr><td>Optical ACD</td><td><input id="acd_r"></td><td>Optical ACD</td><td><input id="acd_l"></td></tr>
      <tr><td>Refraction</td><td><input id="rx_r"></td><td>Refraction</td><td><input id="rx_l"></td></tr>
      <tr><td>Optional:</td><td></td><td>Optional:</td><td></td></tr>
      <tr><td>Lens Thickness</td><td><input id="lt_r"></td><td>Lens Thickness</td><td><input id="lt_l"></td></tr>
      <tr><td>WTW</td><td><input id="wtw_r"></td><td>WTW</td><td><input id="wtw_l"></td></tr>
    </table>
  </div>

  <div id="formula" style="display:none"><div id="results"></div></div>

<script>
const CONSTANTS = { pc: null, sn60wf: [1.88, 118.99], sn6atx: [2.02, 119.26] };

function showTab(which) {
  document.getElementById('data').style.display = which === 'data' ? '' : 'none';
  document.getElementById('formula').style.display = which === 'formula' ? '' : 'none';
}
// The site derives one constant from the other; so does this.
function deriveA() {
  const lf = parseFloat(document.getElementById('lf').value);
  if (!isNaN(lf)) document.getElementById('ac').value = (118.4 + (lf - 1.57) * 1.9195).toFixed(2);
}
function deriveLf() {
  const a = parseFloat(document.getElementById('ac').value);
  if (!isNaN(a)) document.getElementById('lf').value = (1.57 + (a - 118.4) / 1.9195).toFixed(2);
}
function applyLens() {
  const pair = CONSTANTS[document.getElementById('lens').value];
  if (pair) { document.getElementById('lf').value = pair[0]; document.getElementById('ac').value = pair[1]; }
}

function rows(base) {
  let out = '<table><tr><th>IOL Power</th><th>Optic</th><th>Refraction</th></tr>';
  for (let i = 3; i >= -3; i--) {
    // The site's Optic column carries the lens design, not a number.
    out += '<tr><td>' + (base + i * 0.5).toFixed(2) + '</td><td>Biconvex</td><td>' +
           (-i * 0.35).toFixed(2) + '</td></tr>';
  }
  return out + '</table>';
}

function calculate() {
  if (!document.getElementById('patient').value) { alert('Patient Name is required'); return; }
  setTimeout(function () {
    let html = '';
    if (document.getElementById('al_r').value) {
      html += '<h3>Right Eye (OD)</h3><p>Recommended IOL: 21.50</p>' + rows(21.5);
    }
    if (document.getElementById('al_l').value) {
      html += '<h3>Left Eye (OS)</h3><p>Recommended IOL: 22.00</p>' + rows(22);
    }
    document.getElementById('results').innerHTML = html;
    // The tell the automation waits on.
    document.getElementById('mode').textContent = 'View Formula';
  }, ${CALC_DELAY_MS});
}
</script>
</body></html>`;

const port = Number(process.env.MOCK_PORT ?? 4100);
createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
}).listen(port, "127.0.0.1", () => {
  console.log(`Mock calculator on http://127.0.0.1:${port}/ (calc delay ${CALC_DELAY_MS}ms)`);
});
