// Deterministic offline "AI" used for Demo mode (and as a graceful fallback
// when live AI is unavailable). It inspects the case text and returns
// structured output matching what the live model would produce, so the demo
// always works without network access or an API key.

function detectScenario(text) {
  const t = text.toLowerCase();
  if (
    t.includes("string") ||
    t.includes("foreign body") ||
    t.includes("distended abdomen") ||
    (t.includes("vomit") && t.includes("abdomen"))
  ) {
    return "obstruction";
  }
  if (
    t.includes("murmur") ||
    t.includes("cough") ||
    t.includes("exercise intolerance") ||
    t.includes("cardio")
  ) {
    return "chf";
  }
  if (
    t.includes("open-mouth") ||
    t.includes("pleural") ||
    t.includes("muffled heart") ||
    t.includes("effusion")
  ) {
    return "effusion";
  }
  if (
    t.includes("lameness") ||
    t.includes("limb") ||
    t.includes("bone") ||
    t.includes("swelling")
  ) {
    return "osteo";
  }
  return "default";
}

const CLASSIFY = {
  obstruction: {
    priority: "STAT",
    suspected: ["Mechanical SI obstruction", "Linear foreign body"],
    rationale:
      "Acute vomiting with a painful, distended abdomen and possible linear foreign body raises concern for a time-critical mechanical obstruction.",
    confidence: 88,
  },
  chf: {
    priority: "STAT",
    suspected: ["Cardiomegaly", "Left-sided CHF"],
    rationale:
      "A loud left apical murmur with progressive cough and exercise intolerance is concerning for decompensated left-sided heart failure.",
    confidence: 84,
  },
  effusion: {
    priority: "STAT",
    suspected: ["Pleural effusion", "Respiratory distress"],
    rationale:
      "Open-mouth breathing with muffled heart sounds in a cat is an emergency suggesting significant pleural space disease.",
    confidence: 86,
  },
  osteo: {
    priority: "Standard",
    suspected: ["Aggressive bone lesion", "Primary bone tumor"],
    rationale:
      "Progressive forelimb lameness with firm distal limb swelling suggests an aggressive osseous lesion warranting prompt but non-emergent workup.",
    confidence: 80,
  },
  default: {
    priority: "Standard",
    suspected: ["Nonspecific pattern", "Clinical correlation advised"],
    rationale:
      "Findings are nonspecific on the provided history; correlation with imaging and clinical signs is advised.",
    confidence: 66,
  },
};

const DISCLAIMER =
  "This AI-generated preliminary draft requires board-certified radiologist review before clinical use.";

const REPORT = {
  obstruction: {
    technique: "Right lateral and ventrodorsal abdominal radiographs.",
    findings:
      "Segmental gas- and fluid-distended small intestinal loops are present with an abrupt change in luminal caliber in the mid-abdomen. The proximal bowel appears plicated. No free peritoneal gas is identified.",
    impression:
      "Findings are most consistent with mechanical small intestinal obstruction; a linear foreign body is suspected given the bowel plication.",
    recommendations:
      "Urgent surgical consultation and consideration of exploratory laparotomy. Abdominal ultrasound if surgery is delayed.",
    disclaimer: DISCLAIMER,
  },
  chf: {
    technique: "Right lateral and dorsoventral thoracic radiographs.",
    findings:
      "Generalized cardiomegaly is present with an increased vertebral heart score. The pulmonary veins are distended and a perihilar interstitial-to-alveolar pattern is noted.",
    impression:
      "Cardiogenic pulmonary edema secondary to left-sided congestive heart failure is the leading consideration.",
    recommendations:
      "Initiate diuretic therapy as clinically indicated and pursue echocardiography for definitive cardiac characterization.",
    disclaimer: DISCLAIMER,
  },
  effusion: {
    technique: "Lateral and dorsoventral thoracic radiographs (handling-minimized).",
    findings:
      "Moderate pleural effusion is present with retraction of the lung lobes and partial silhouetting of the cardiac margins. Pleural fissure lines are visible.",
    impression:
      "Pleural effusion of undetermined origin; cardiac, neoplastic, and infectious causes are considerations.",
    recommendations:
      "Stabilize and perform thoracocentesis with fluid analysis. Minimize handling stress in this dyspneic patient.",
    disclaimer: DISCLAIMER,
  },
  osteo: {
    technique: "Orthogonal radiographs of the affected forelimb.",
    findings:
      "An aggressive lytic lesion is present in the distal radius with cortical destruction and a palisading periosteal reaction. The lesion does not appear to cross the adjacent joint.",
    impression:
      "Aggressive primary bone lesion; osteosarcoma is most likely given the signalment and location.",
    recommendations:
      "Three-view thoracic radiographs for metastatic screening and bone biopsy for definitive diagnosis.",
    disclaimer: DISCLAIMER,
  },
  default: {
    technique: "Two-view study of the region of interest.",
    findings:
      "No definitive radiographic abnormality is described in the provided history. Image quality and positioning should be confirmed.",
    impression: "Nonspecific findings; clinical correlation is recommended.",
    recommendations: "Correlate with clinical signs and consider additional imaging if signs persist.",
    disclaimer: DISCLAIMER,
  },
};

function answerAddendum(question, userContent) {
  const q = question.toLowerCase();
  const scenario = detectScenario(userContent);
  const tail =
    " Final interpretation rests with the board-certified radiologist reviewing this case.";

  if (q.includes("surgery") || q.includes("operate") || q.includes("monitor")) {
    if (scenario === "obstruction")
      return "The preliminary findings of a mechanical obstruction with suspected linear foreign body favor urgent surgical evaluation over watchful monitoring, as delayed intervention risks bowel compromise." + tail;
    return "Whether to operate or monitor depends on the confirmed diagnosis and the patient's stability; the draft supports prompt specialist input before deciding." + tail;
  }
  if (q.includes("sedation") || q.includes("anesth")) {
    if (scenario === "effusion")
      return "Sedation carries elevated risk in a dyspneic patient with pleural effusion; stabilization and possible thoracocentesis before any sedation is prudent." + tail;
    return "Sedation safety should be weighed against the patient's cardiorespiratory stability noted in the case; coordinate with the attending clinician." + tail;
  }
  if (q.includes("differential") || q.includes("bloodwork") || q.includes("normal")) {
    return "Even with unremarkable bloodwork, the radiographic differentials in the impression remain relevant and should guide the next diagnostic step described in the recommendations." + tail;
  }
  if (q.includes("prognosis") || q.includes("outcome")) {
    return "Prognosis cannot be established from this preliminary draft alone; it depends on confirmatory diagnostics and the recommendations outlined in the report." + tail;
  }
  return "Based on the preliminary report, this question is best addressed by the recommended next steps in the draft rather than the radiographs alone." + tail;
}

// Returns a string: JSON for the classify/report stages, plain text for addenda
// — matching the contract the component expects from the live model.
export function mockClaude(systemPrompt, userContent) {
  const sys = (systemPrompt || "").toLowerCase();
  const content = userContent || "";
  // The report prompt appends retrieved "similar prior cases" as reference.
  // Detect the scenario from the actual case/suspected text only, so those
  // reference cases don't skew the draft toward their content.
  const focus = content.split(/SIMILAR PRIOR CASES/i)[0];

  if (sys.includes("triage agent")) {
    return JSON.stringify(CLASSIFY[detectScenario(content)]);
  }
  if (sys.includes("drafting a preliminary report") || sys.includes("preliminary report")) {
    return JSON.stringify(REPORT[detectScenario(focus)]);
  }
  if (sys.includes("follow-up question")) {
    const m = content.match(/VET QUESTION:\s*([\s\S]*)$/i);
    const question = m ? m[1].trim() : content;
    return answerAddendum(question, content);
  }
  return JSON.stringify(REPORT.default);
}
