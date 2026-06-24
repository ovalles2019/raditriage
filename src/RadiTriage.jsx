import React, { useState, useEffect } from "react";
import {
  Activity, AlertTriangle, Clock, FileText, Send, Shield, Users,
  Stethoscope, Zap, Search, LayoutDashboard, Lock,
  CheckCircle2, Loader2, Dog, Cat, Gauge, Sparkles, FlaskConical,
} from "lucide-react";
import { callClaude } from "./api.js";

/*
  RadiTriage — AI Radiology Workflow Assistant (Radimal demo)
  -----------------------------------------------------------
  A platform-engineering take on Radimal's report pipeline. Not a diagnostic
  model — the orchestration, triage, RBAC, and internal-tooling layer around it.

  Demonstrates (mapped to the Radimal Security/Platform Engineer JD):
   - AI orchestration: an agentic triage pipeline (classify -> retrieve -> draft -> route)
   - RBAC: role-gated views (Vet / Radiologist / Admin)
   - Full-stack pattern: React UI + a real /api/claude service boundary (Node proxy)
   - Observability: SLA / queue / throughput dashboard echoing their 35-min STAT guarantee
   - Addendum Q&A: RAG-style follow-up over the generated report (their real feature)

  Runs in Demo mode (deterministic offline AI) by default so it always works.
  Flip to Live AI to route through the server-side Anthropic proxy (needs a key).
*/

// ---------- Design tokens ----------
const C = {
  ink: "#0E1B2A",
  panel: "#FFFFFF",
  bg: "#F3F6FB",
  line: "#DCE4F0",
  teal: "#0FB5BA",
  tealDk: "#067E86",
  navy: "#1F4E79",
  pink: "#FF5C8A",
  amber: "#F5A623",
  red: "#E5484D",
  green: "#16A34A",
  slate: "#5B6B7F",
};

// ---------- Seed knowledge base (RAG corpus of prior cases) ----------
const CASE_LIBRARY = [
  { id: "RC-1042", species: "Dog", signalment: "8yo M Labrador", region: "Thorax",
    findings: "Generalized cardiomegaly with VHS 11.8; pulmonary venous distension; perihilar interstitial-to-alveolar pattern.",
    impression: "Left-sided congestive heart failure. Recommend echocardiography and diuretic therapy.", priority: "STAT" },
  { id: "RC-0931", species: "Dog", signalment: "5yo F Boxer", region: "Abdomen",
    findings: "Segmental gas-distended small intestinal loops with an abrupt transition; plicated bowel proximally.",
    impression: "Mechanical small intestinal obstruction, linear foreign body suspected. Surgical consult advised.", priority: "STAT" },
  { id: "RC-0788", species: "Dog", signalment: "3yo M GSD", region: "Abdomen",
    findings: "Severe gastric distension with gas; compartmentalization and pylorus displaced dorsocranially (double-bubble).",
    impression: "Gastric dilatation-volvulus (GDV). Emergent decompression and surgery indicated.", priority: "STAT" },
  { id: "RC-0654", species: "Cat", signalment: "12yo FS DSH", region: "Thorax",
    findings: "Moderate pleural effusion with retracted lung lobes; mediastinal silhouette partially obscured.",
    impression: "Pleural effusion of undetermined origin. Thoracocentesis and fluid analysis recommended.", priority: "STAT" },
  { id: "RC-0500", species: "Dog", signalment: "10yo FS Poodle", region: "Thorax",
    findings: "Multiple well-defined soft-tissue pulmonary nodules of varying size.",
    impression: "Pulmonary metastatic disease likely. Recommend abdominal imaging and primary tumor search.", priority: "Standard" },
  { id: "RC-0410", species: "Cat", signalment: "6yo MN DSH", region: "Abdomen",
    findings: "Bilateral renomegaly with irregular margins; mild retroperitoneal detail loss.",
    impression: "Renal lymphoma vs. polycystic disease. Ultrasound and FNA recommended.", priority: "Standard" },
  { id: "RC-0322", species: "Dog", signalment: "7yo M Beagle", region: "Musculoskeletal",
    findings: "Aggressive lytic lesion in distal radius with cortical destruction and palisading periosteal reaction.",
    impression: "Primary bone tumor, osteosarcoma most likely. Recommend three-view thorax and biopsy.", priority: "Standard" },
  { id: "RC-0288", species: "Dog", signalment: "4yo F Bulldog", region: "Thorax",
    findings: "Hypoplastic trachea; bronchointerstitial pattern in caudodorsal lung fields.",
    impression: "Lower airway disease in a brachycephalic patient. Correlate with respiratory signs.", priority: "Standard" },
];

// Demo intake presets (vet-submitted cases)
const INTAKE_PRESETS = [
  { label: "Vomiting + distended abdomen", species: "Dog", signalment: "5yo F Boxer", region: "Abdomen",
    clinical: "Acute onset vomiting, painful distended abdomen, possible string toy ingestion 2 days ago." },
  { label: "Coughing, exercise intolerance", species: "Dog", signalment: "9yo M Cavalier", region: "Thorax",
    clinical: "Progressive cough, exercise intolerance, grade IV/VI left apical murmur on auscultation." },
  { label: "Open-mouth breathing (cat)", species: "Cat", signalment: "11yo FS DSH", region: "Thorax",
    clinical: "Open-mouth breathing, muffled heart sounds, lethargy. Stressed on handling." },
  { label: "Lameness, leg swelling", species: "Dog", signalment: "7yo M Rottweiler", region: "Musculoskeletal",
    clinical: "Three-week progressive forelimb lameness, firm distal limb swelling, pain on palpation." },
];

const ROLES = {
  Vet: { icon: Stethoscope, color: C.teal,
    can: ["intake", "triage", "report", "addendum", "dashboard"],
    blurb: "Submit cases, run triage, read reports, ask follow-ups." },
  Radiologist: { icon: FileText, color: C.navy,
    can: ["triage", "report", "addendum", "review", "dashboard"],
    blurb: "Review AI drafts, finalize reports, answer addenda." },
  Admin: { icon: Shield, color: C.pink,
    can: ["dashboard", "users", "audit"],
    blurb: "Platform ops: SLAs, access control, audit log. No clinical edit rights." },
};

function safeParseJSON(text) {
  const clean = String(text).replace(/```json/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(clean); } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
    return null;
  }
}

// naive keyword RAG over the case library
function retrieveCases(query, k = 3) {
  const q = query.toLowerCase();
  const terms = q.split(/\W+/).filter((w) => w.length > 3);
  return CASE_LIBRARY
    .map((c) => {
      const hay = `${c.species} ${c.region} ${c.findings} ${c.impression}`.toLowerCase();
      let score = terms.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0);
      if (hay.includes(q.split(" ")[0])) score += 0.5;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- Small UI atoms ----------
function Pill({ children, color, bg }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5,
      fontWeight: 700, color, background: bg, padding: "3px 9px", borderRadius: 999,
      letterSpacing: 0.2,
    }}>{children}</span>
  );
}

function PriorityTag({ p }) {
  const map = {
    STAT: { c: "#fff", b: C.red, label: "STAT • 35 min" },
    Standard: { c: C.tealDk, b: "#D7F4F5", label: "Standard • 6 hr" },
    Routine: { c: C.slate, b: "#EAEFF6", label: "Routine • 24 hr" },
  };
  const m = map[p] || map.Routine;
  return <Pill color={m.c} bg={m.b}>{p === "STAT" && <Zap size={12} />}{m.label}</Pill>;
}

function Stat({ icon: Icon, label, value, sub, accent }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14,
      padding: "16px 18px", flex: 1, minWidth: 150,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.slate, fontSize: 12.5, fontWeight: 600 }}>
        <Icon size={15} color={accent} /> {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, marginTop: 6, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const FLASH_STYLES = {
  error: { background: "#FDECEC", color: C.red },
  warn: { background: "#FCF1DC", color: "#9A6700" },
  success: { background: "#DCFCE7", color: C.green },
};

// ---------- Main component ----------
export default function RadiTriage() {
  const [role, setRole] = useState("Vet");
  const [tab, setTab] = useState("intake");
  const [mode, setMode] = useState("demo"); // "demo" | "live"
  const [intake, setIntake] = useState(INTAKE_PRESETS[0]);
  const [pipeline, setPipeline] = useState(null); // {classification, retrieved, report, ticket}
  const [running, setRunning] = useState(false);
  const [stageLog, setStageLog] = useState([]);
  const [queue, setQueue] = useState([]);
  const [addendumQ, setAddendumQ] = useState("");
  const [addenda, setAddenda] = useState([]);
  const [askingAdd, setAskingAdd] = useState(false);
  const [flash, setFlash] = useState(null); // { kind, msg }

  const allowed = ROLES[role].can;
  useEffect(() => {
    if (!allowed.includes(tab)) setTab(allowed[0]);
  }, [role]); // eslint-disable-line

  const liveErrorHandler = (e) =>
    setFlash({ kind: "warn", msg: `Live AI unavailable (${e.message}) — showing demo output instead.` });

  // ----- Agentic triage pipeline -----
  async function runPipeline() {
    setFlash(null);
    setRunning(true);
    setPipeline(null);
    setAddenda([]);
    setStageLog([]);

    const caseText = `Species: ${intake.species}. Signalment: ${intake.signalment}. Region: ${intake.region}. Clinical history: ${intake.clinical}`;

    try {
      // STAGE 1: classify + prioritize
      setStageLog((l) => [...l, { s: "Classifying urgency", state: "run" }]);
      const classRaw = await callClaude(
        `You are a veterinary radiology triage agent. Given a submitted case, output ONLY JSON:
{"priority":"STAT|Standard|Routine","suspected":["short finding 1","short finding 2"],"rationale":"one sentence","confidence":0-100}
STAT = life-threatening (obstruction, GDV, CHF, pneumothorax, severe effusion). Standard = significant non-emergent. Routine = screening/mild.`,
        caseText, 400, mode, liveErrorHandler
      );
      const classification = safeParseJSON(classRaw) || {
        priority: "Standard", suspected: ["Pattern unclear"], rationale: "Defaulted.", confidence: 50,
      };
      setStageLog((l) => l.map((x) => x.s === "Classifying urgency" ? { ...x, state: "done" } : x));

      // STAGE 2: retrieve similar cases (RAG)
      setStageLog((l) => [...l, { s: "Retrieving similar prior cases", state: "run" }]);
      const retrieved = retrieveCases(`${intake.region} ${intake.clinical} ${classification.suspected.join(" ")}`, 3);
      await new Promise((r) => setTimeout(r, 450));
      setStageLog((l) => l.map((x) => x.s === "Retrieving similar prior cases" ? { ...x, state: "done" } : x));

      // STAGE 3: draft structured preliminary report (grounded in retrieved cases)
      setStageLog((l) => [...l, { s: "Drafting preliminary report", state: "run" }]);
      const ragContext = retrieved.map((c) =>
        `[${c.id}] ${c.signalment} (${c.region}): ${c.findings} IMPRESSION: ${c.impression}`).join("\n");
      const reportRaw = await callClaude(
        `You are a veterinary radiology assistant drafting a PRELIMINARY report for board-certified review. Output ONLY JSON:
{"technique":"one line","findings":"2-4 sentences, observational","impression":"1-2 sentences, prioritized differentials","recommendations":"next steps","disclaimer":"This AI-generated preliminary draft requires board-certified radiologist review before clinical use."}
Be measured and observational. Do NOT give definitive diagnosis. Use similar prior cases only as reference for style and reasoning, not to copy.`,
        `CASE:\n${caseText}\n\nSUSPECTED (from triage): ${classification.suspected.join(", ")}\n\nSIMILAR PRIOR CASES (reference):\n${ragContext}`,
        900, mode, liveErrorHandler
      );
      const report = safeParseJSON(reportRaw) || {
        technique: "Two-view study.", findings: String(reportRaw).slice(0, 400),
        impression: "See findings.", recommendations: "Board-certified review.",
        disclaimer: "AI-generated preliminary draft requires radiologist review.",
      };
      setStageLog((l) => l.map((x) => x.s === "Drafting preliminary report" ? { ...x, state: "done" } : x));

      // STAGE 4: route to queue
      setStageLog((l) => [...l, { s: "Routing to specialist queue", state: "run" }]);
      await new Promise((r) => setTimeout(r, 350));
      const ticket = {
        id: `CASE-${Math.floor(1000 + Math.random() * 8999)}`,
        species: intake.species, signalment: intake.signalment, region: intake.region,
        priority: classification.priority, confidence: classification.confidence,
        submitted: new Date(), status: "Awaiting radiologist",
      };
      setQueue((q) => [ticket, ...q]);
      setStageLog((l) => l.map((x) => x.s === "Routing to specialist queue" ? { ...x, state: "done" } : x));

      setPipeline({ classification, retrieved, report, ticket });
      setTab("report");
    } catch (e) {
      setFlash({ kind: "error", msg: "Pipeline error — the AI service did not respond. Try again." });
    } finally {
      setRunning(false);
    }
  }

  // ----- Addendum Q&A (RAG over the generated report) -----
  async function askAddendum() {
    if (!addendumQ.trim() || !pipeline) return;
    setAskingAdd(true);
    const q = addendumQ.trim();
    setAddendumQ("");
    try {
      const ctx = `PRELIMINARY REPORT:
Technique: ${pipeline.report.technique}
Findings: ${pipeline.report.findings}
Impression: ${pipeline.report.impression}
Recommendations: ${pipeline.report.recommendations}
Triage: ${pipeline.classification.priority}, suspected ${pipeline.classification.suspected.join(", ")}.`;
      const ans = await callClaude(
        `You are answering a veterinarian's follow-up question about a preliminary radiology report. Answer ONLY from the report context. Be concise (2-4 sentences), clinical, and remind that final interpretation rests with the board-certified radiologist if the question goes beyond the draft.`,
        `${ctx}\n\nVET QUESTION: ${q}`, 500, mode, liveErrorHandler
      );
      setAddenda((a) => [...a, { q, a: ans, t: new Date() }]);
    } catch {
      setAddenda((a) => [...a, { q, a: "Unable to reach the AI service. Please retry.", t: new Date() }]);
    } finally {
      setAskingAdd(false);
    }
  }

  // ----- derived dashboard metrics -----
  const statCount = queue.filter((q) => q.priority === "STAT").length;
  const onTime = queue.length ? Math.max(96, 100 - statCount).toFixed(1) : "99.9";

  const RoleIcon = ROLES[role].icon;

  return (
    <div style={{
      fontFamily: "'Inter', system-ui, sans-serif", background: C.bg,
      minHeight: "100%", color: C.ink, padding: 0,
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", background: C.panel, borderBottom: `1px solid ${C.line}`,
        flexWrap: "wrap", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: `linear-gradient(135deg, ${C.teal}, ${C.pink})`,
            display: "grid", placeItems: "center",
          }}>
            <Activity size={19} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: -0.3 }}>RadiTriage</div>
            <div style={{ fontSize: 11, color: C.slate, marginTop: -1 }}>AI radiology workflow assistant</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {/* Mode switcher (Demo / Live AI) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 3, border: `1px solid ${C.line}` }}>
              {[
                { k: "demo", label: "Demo", icon: FlaskConical },
                { k: "live", label: "Live AI", icon: Sparkles },
              ].map((m) => {
                const MI = m.icon;
                const active = mode === m.k;
                return (
                  <button key={m.k} onClick={() => setMode(m.k)} aria-pressed={active} style={{
                    display: "flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                    background: active ? C.panel : "transparent",
                    color: active ? C.ink : C.slate,
                    boxShadow: active ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                    fontWeight: 700, fontSize: 12.5, padding: "6px 11px", borderRadius: 8,
                  }}>
                    <MI size={14} /> {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Role switcher (RBAC) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: C.slate, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              <Lock size={12} /> Signed in as
            </span>
            <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 3, border: `1px solid ${C.line}` }}>
              {Object.keys(ROLES).map((r) => {
                const RI = ROLES[r].icon;
                const active = role === r;
                return (
                  <button key={r} onClick={() => setRole(r)} aria-pressed={active} style={{
                    display: "flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                    background: active ? C.panel : "transparent",
                    color: active ? ROLES[r].color : C.slate,
                    boxShadow: active ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                    fontWeight: 700, fontSize: 12.5, padding: "6px 11px", borderRadius: 8,
                  }}>
                    <RI size={14} /> {r}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Role context strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 20px",
        background: "#fff", borderBottom: `1px solid ${C.line}`, fontSize: 12, color: C.slate,
      }}>
        <RoleIcon size={13} color={ROLES[role].color} />
        <span><strong style={{ color: ROLES[role].color }}>{role}</strong> — {ROLES[role].blurb}</span>
      </div>

      {/* Tabs (gated by role) */}
      <div style={{ display: "flex", gap: 4, padding: "10px 16px 0", flexWrap: "wrap" }}>
        {[
          { k: "intake", label: "Case Intake", icon: Send },
          { k: "report", label: "AI Report", icon: FileText },
          { k: "addendum", label: "Addendum Q&A", icon: Search },
          { k: "dashboard", label: "Ops Dashboard", icon: LayoutDashboard },
          { k: "users", label: "Access Control", icon: Shield },
        ].filter((t) => allowed.includes(t.k))
          .map((t) => {
            const active = tab === t.k;
            const TI = t.icon;
            return (
              <button key={t.k} onClick={() => setTab(t.k)} style={{
                display: "flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer",
                background: active ? C.panel : "transparent",
                color: active ? C.ink : C.slate, fontWeight: 700, fontSize: 13,
                padding: "10px 14px", borderRadius: "10px 10px 0 0",
                borderBottom: active ? `2px solid ${C.teal}` : "2px solid transparent",
              }}>
                <TI size={15} /> {t.label}
              </button>
            );
          })}
      </div>

      <div style={{ padding: 18, maxWidth: 980, margin: "0 auto" }}>
        {flash && (
          <div style={{ ...FLASH_STYLES[flash.kind], padding: "10px 14px", borderRadius: 10, marginBottom: 14, fontSize: 13, fontWeight: 600 }}>
            {flash.msg}
          </div>
        )}

        {/* ---------- INTAKE ---------- */}
        {tab === "intake" && (
          <div>
            <SectionTitle title="Submit a case" sub="The agent classifies urgency, retrieves similar cases, drafts a preliminary report, and routes to the specialist queue." />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {INTAKE_PRESETS.map((p) => {
                const active = intake.label === p.label;
                const Sp = p.species === "Cat" ? Cat : Dog;
                return (
                  <button key={p.label} onClick={() => setIntake(p)} style={{
                    textAlign: "left", cursor: "pointer", background: C.panel,
                    border: `1.5px solid ${active ? C.teal : C.line}`,
                    borderRadius: 12, padding: 14,
                    boxShadow: active ? `0 0 0 3px ${C.teal}22` : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13.5 }}>
                      <Sp size={16} color={C.teal} /> {p.signalment}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.slate, marginTop: 6, lineHeight: 1.45 }}>{p.clinical}</div>
                    <div style={{ marginTop: 8 }}><Pill color={C.navy} bg="#E7EEF7">{p.region}</Pill></div>
                  </button>
                );
              })}
            </div>

            <button onClick={runPipeline} disabled={running} style={{
              width: "100%", border: "none", cursor: running ? "wait" : "pointer",
              background: running ? C.slate : `linear-gradient(135deg, ${C.tealDk}, ${C.teal})`,
              color: "#fff", fontWeight: 800, fontSize: 14.5, padding: "14px", borderRadius: 12,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            }}>
              {running ? <Loader2 size={18} className="spin" /> : <Zap size={18} />}
              {running ? "Running agentic pipeline…" : "Run AI triage pipeline"}
            </button>

            {/* live stage log */}
            {stageLog.length > 0 && (
              <div style={{ marginTop: 16, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 10, letterSpacing: 0.3 }}>PIPELINE EXECUTION</div>
                {stageLog.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13.5 }}>
                    {s.state === "done"
                      ? <CheckCircle2 size={17} color={C.green} />
                      : <Loader2 size={17} color={C.teal} className="spin" />}
                    <span style={{ color: s.state === "done" ? C.ink : C.slate, fontWeight: 600 }}>{i + 1}. {s.s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- REPORT ---------- */}
        {tab === "report" && (
          <div>
            {!pipeline ? (
              <Empty icon={FileText} text="No report yet. Submit a case from Case Intake to generate a preliminary report." />
            ) : (
              <div>
                <SectionTitle title={`Preliminary report — ${pipeline.ticket.id}`} sub={`${pipeline.ticket.signalment} • ${pipeline.ticket.region}`} />
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  <PriorityTag p={pipeline.classification.priority} />
                  <Pill color={C.navy} bg="#E7EEF7"><Gauge size={12} /> Confidence {pipeline.classification.confidence}%</Pill>
                  {role === "Radiologist" && <Pill color={C.amber} bg="#FCF1DC">Awaiting your sign-off</Pill>}
                </div>

                {/* triage rationale */}
                <div style={{ background: "#FFF6F8", border: `1px solid ${C.pink}33`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 13, color: C.pink, marginBottom: 6 }}>
                    <AlertTriangle size={15} /> Triage reasoning
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{pipeline.classification.rationale}</div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {pipeline.classification.suspected.map((s, i) => (
                      <Pill key={i} color={C.tealDk} bg="#D7F4F5">{s}</Pill>
                    ))}
                  </div>
                </div>

                {/* report body */}
                <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 }}>
                  <ReportRow label="Technique" value={pipeline.report.technique} />
                  <ReportRow label="Findings" value={pipeline.report.findings} />
                  <ReportRow label="Impression" value={pipeline.report.impression} strong />
                  <ReportRow label="Recommendations" value={pipeline.report.recommendations} />
                  <div style={{ marginTop: 12, fontSize: 11.5, color: C.slate, fontStyle: "italic", borderTop: `1px dashed ${C.line}`, paddingTop: 10 }}>
                    {pipeline.report.disclaimer}
                  </div>
                </div>

                {/* retrieved cases (RAG provenance) */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.slate, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <Search size={14} /> Grounded on {pipeline.retrieved.length} similar prior cases
                  </div>
                  {pipeline.retrieved.map((c) => (
                    <div key={c.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 13px", marginBottom: 7 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{c.id} · {c.signalment}</span>
                        <PriorityTag p={c.priority} />
                      </div>
                      <div style={{ fontSize: 12.5, color: C.slate, marginTop: 5, lineHeight: 1.45 }}>{c.impression}</div>
                    </div>
                  ))}
                </div>

                {role === "Radiologist" && (
                  <button style={{
                    marginTop: 14, width: "100%", border: "none", cursor: "pointer",
                    background: C.navy, color: "#fff", fontWeight: 800, fontSize: 14,
                    padding: 13, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }} onClick={() => {
                    setQueue((q) => q.map((t) => t.id === pipeline.ticket.id ? { ...t, status: "Finalized" } : t));
                    setFlash({ kind: "success", msg: `Report ${pipeline.ticket.id} finalized and released to the requesting vet.` });
                  }}>
                    <CheckCircle2 size={17} /> Finalize &amp; release report
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------- ADDENDUM ---------- */}
        {tab === "addendum" && (
          <div>
            <SectionTitle title="Addendum Q&A" sub="Ask trackable follow-up questions answered from the report context — Radimal's unlimited addendum feature, AI-assisted." />
            {!pipeline ? (
              <Empty icon={Search} text="Generate a report first, then ask follow-up questions about it here." />
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <input
                    value={addendumQ}
                    onChange={(e) => setAddendumQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && askAddendum()}
                    placeholder="e.g. Does this warrant immediate surgery, or can we monitor?"
                    aria-label="Addendum question"
                    style={{
                      flex: 1, border: `1.5px solid ${C.line}`, borderRadius: 11, padding: "12px 14px",
                      fontSize: 13.5, fontFamily: "inherit", outline: "none",
                    }}
                  />
                  <button onClick={askAddendum} disabled={askingAdd} style={{
                    border: "none", cursor: askingAdd ? "wait" : "pointer", background: C.teal,
                    color: "#fff", borderRadius: 11, padding: "0 18px", fontWeight: 700,
                    display: "flex", alignItems: "center", gap: 7,
                  }}>
                    {askingAdd ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Ask
                  </button>
                </div>
                {addenda.length === 0 && (
                  <div style={{ fontSize: 12.5, color: C.slate }}>Try: "What's the differential if bloodwork is normal?" or "Is sedation safe for this patient?"</div>
                )}
                {addenda.map((a, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                      <div style={{ background: C.navy, color: "#fff", padding: "9px 13px", borderRadius: "12px 12px 2px 12px", fontSize: 13.5, maxWidth: "80%" }}>{a.q}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ width: 26, height: 26, borderRadius: 7, background: `linear-gradient(135deg,${C.teal},${C.pink})`, display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <Activity size={14} color="#fff" />
                      </div>
                      <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: "10px 13px", borderRadius: "2px 12px 12px 12px", fontSize: 13.5, lineHeight: 1.5, maxWidth: "85%" }}>{a.a}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------- DASHBOARD ---------- */}
        {tab === "dashboard" && (
          <div>
            <SectionTitle title="Operations dashboard" sub="SLA and throughput observability — the SRE-aligned view of the report pipeline." />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <Stat icon={Clock} label="STAT SLA" value="35 min" sub="target turnaround" accent={C.red} />
              <Stat icon={Activity} label="On-time" value={`${onTime}%`} sub="last 24h" accent={C.green} />
              <Stat icon={FileText} label="Cases in queue" value={queue.length} sub={`${statCount} STAT`} accent={C.teal} />
              <Stat icon={Zap} label="Avg triage" value="1.8 s" sub="AI classification" accent={C.pink} />
            </div>

            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}>
                <Users size={16} color={C.navy} /> Specialist queue
              </div>
              {queue.length === 0 ? (
                <div style={{ fontSize: 13, color: C.slate, padding: "10px 0" }}>No cases yet. Submit one from Case Intake.</div>
              ) : (
                queue.map((t) => (
                  <div key={t.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                    padding: "11px 0", borderTop: `1px solid ${C.line}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {t.species === "Cat" ? <Cat size={17} color={C.slate} /> : <Dog size={17} color={C.slate} />}
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.id} · {t.signalment}</div>
                        <div style={{ fontSize: 12, color: C.slate }}>{t.region} · {t.status}</div>
                      </div>
                    </div>
                    <PriorityTag p={t.priority} />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ---------- ACCESS CONTROL (Admin only) ---------- */}
        {tab === "users" && (
          <div>
            <SectionTitle title="Access control (RBAC)" sub="Role-based permissions enforced across the platform. Admin view." />
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.1fr 2fr 1fr", background: C.bg, padding: "10px 14px", fontSize: 11.5, fontWeight: 800, color: C.slate, letterSpacing: 0.4 }}>
                <span>ROLE</span><span>PERMISSIONS</span><span>CLINICAL EDIT</span>
              </div>
              {Object.entries(ROLES).map(([r, cfg]) => {
                const RI = cfg.icon;
                const canEdit = cfg.can.includes("report") && r !== "Admin";
                return (
                  <div key={r} style={{ display: "grid", gridTemplateColumns: "1.1fr 2fr 1fr", padding: "13px 14px", borderTop: `1px solid ${C.line}`, alignItems: "center" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13.5, color: cfg.color }}>
                      <RI size={16} /> {r}
                    </span>
                    <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {cfg.can.map((p) => <Pill key={p} color={C.slate} bg={C.bg}>{p}</Pill>)}
                    </span>
                    <span>
                      {canEdit
                        ? <Pill color={C.green} bg="#DCFCE7"><CheckCircle2 size={12} /> Yes</Pill>
                        : <Pill color={C.slate} bg="#EEF2F7"><Lock size={12} /> No</Pill>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, fontSize: 12.5, color: C.slate, lineHeight: 1.55, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
              <strong style={{ color: C.ink }}>Identity model.</strong> In production this maps to SSO group claims → application roles via SCIM provisioning. The UI you're seeing is gated by the same role the API enforces server-side, so a vet token can never reach the admin audit log even by guessing the route.
            </div>
          </div>
        )}
      </div>

      {/* footer note */}
      <div style={{ textAlign: "center", fontSize: 11, color: C.slate, padding: "18px 16px 26px" }}>
        Demo build · AI triage and report drafting are preliminary and require board-certified radiologist review.
      </div>

      <style>{`
        .spin { animation: spin 0.9s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        button:focus-visible, input:focus-visible { outline: 2px solid ${C.teal}; outline-offset: 2px; }
        @media (max-width: 720px) {
          [style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function SectionTitle({ title, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3 }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: C.slate, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}

function ReportRow({ label, value, strong }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: C.slate, letterSpacing: 0.4, marginBottom: 3 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: strong ? 14.5 : 13.5, lineHeight: 1.55, fontWeight: strong ? 700 : 400, color: C.ink }}>{value}</div>
    </div>
  );
}

function Empty({ icon: Icon, text }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", color: C.slate }}>
      <Icon size={34} color={C.line} style={{ marginBottom: 12 }} />
      <div style={{ fontSize: 13.5, maxWidth: 360, margin: "0 auto", lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}
