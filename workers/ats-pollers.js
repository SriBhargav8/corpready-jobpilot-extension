/**
 * JobPilot — ATS feed pollers (Spec v2 §2, Tier 1)
 * Polls public, structured job feeds. No scraping, no auth.
 * Run: node workers/ats-pollers.js            (polls all active boards)
 *      node workers/ats-pollers.js --fixtures (offline test with fixtures/)
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const FEEDS = {
  greenhouse: (slug) =>
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

// ── Normalizers: each ATS payload → common job shape ─────────────

function normGreenhouse(slug, payload) {
  return (payload.jobs || []).map((j) => ({
    source: "greenhouse",
    external_id: String(j.id),
    title: j.title,
    company: slug,
    location: j.location?.name || null,
    jd_text: stripHtml(j.content || ""),
    apply_url: j.absolute_url,
    posted_at: j.updated_at || null,
  }));
}

function normLever(slug, payload) {
  return (Array.isArray(payload) ? payload : []).map((j) => ({
    source: "lever",
    external_id: j.id,
    title: j.text,
    company: slug,
    location: j.categories?.location || null,
    jd_text: stripHtml(
      (j.descriptionPlain || j.description || "") +
        "\n" +
        (j.lists || [])
          .map((l) => l.text + "\n" + stripHtml(l.content || ""))
          .join("\n")
    ),
    apply_url: j.applyUrl || j.hostedUrl,
    posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
  }));
}

function normAshby(slug, payload) {
  return (payload.jobs || []).map((j) => ({
    source: "ashby",
    external_id: j.id,
    title: j.title,
    company: slug,
    location: j.location || null,
    jd_text: stripHtml(j.descriptionHtml || j.descriptionPlain || ""),
    apply_url: j.jobUrl || j.applyUrl,
    posted_at: j.publishedAt || null,
  }));
}

const NORMALIZERS = {
  greenhouse: normGreenhouse,
  lever: normLever,
  ashby: normAshby,
};

// ── Signal extraction (Spec v2 §4) ───────────────────────────────

const SPONSOR_POS =
  /\b(visa sponsorship (is )?available|we sponsor|will sponsor|h-?1b|sponsorship provided|work permit support)\b/i;
const SPONSOR_NEG =
  /\b(no (visa )?sponsorship|not (able|willing) to sponsor|must be (legally )?authori[sz]ed to work|without sponsorship|unable to sponsor|cannot sponsor|right to work .{0,20}required|citizens? (or|and) permanent residents? only)\b/i;

function visaSignal(jd) {
  if (SPONSOR_NEG.test(jd)) return "no-sponsor";
  if (SPONSOR_POS.test(jd)) return "sponsor";
  return "unknown";
}

const REMOTE_GLOBAL = /\b(remote[- ](anywhere|global|worldwide)|work from anywhere)\b/i;
const REMOTE_ANY = /\bremote\b/i;
const HYBRID = /\bhybrid\b/i;

function remoteType(jd, location) {
  const hay = `${location || ""} ${jd}`;
  if (REMOTE_GLOBAL.test(hay)) return "remote-global";
  if (HYBRID.test(hay)) return "hybrid";
  if (REMOTE_ANY.test(hay)) return "remote-country";
  return "onsite";
}

// Scam heuristics (career-ops-inspired legitimacy block). Score >= 3 → quarantine.
const SCAM_RULES = [
  [/registration fee|processing fee|pay .{0,20}(deposit|fee)|refundable (fee|deposit)/i, 3],
  [/(whatsapp|telegram) (us|me|hr)|interview (on|via) (whatsapp|telegram)/i, 2],
  [/no experience (needed|required).{0,40}(\$|₹|£|€)\s?\d{3,}/i, 2],
  [/(gmail|yahoo|hotmail)\.com\b.{0,30}(send|apply|resume)/i, 1],
  [/earn (up to )?(\$|₹)\s?\d+.{0,15}(per (day|week)|daily|weekly)/i, 2],
  [/urgent(ly)? hiring.{0,30}(immediate joining|same day)/i, 1],
];

function scamScore(jd) {
  return SCAM_RULES.reduce((s, [re, w]) => s + (re.test(jd) ? w : 0), 0);
}

function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function enrich(job) {
  return {
    ...job,
    visa_signal: visaSignal(job.jd_text),
    remote_type: remoteType(job.jd_text, job.location),
    scam_score: scamScore(job.jd_text),
  };
}

// ── Poll + upsert ────────────────────────────────────────────────

async function pollBoard({ ats_type, slug }) {
  const url = FEEDS[ats_type]?.(slug);
  if (!url) return [];
  const res = await fetch(url, { headers: { "User-Agent": "JobPilot/1.0" } });
  if (!res.ok) throw new Error(`${ats_type}/${slug} → HTTP ${res.status}`);
  const payload = await res.json();
  return NORMALIZERS[ats_type](slug, payload).map(enrich);
}

let dbInstance = null;
async function getDb() {
  if (dbInstance) return dbInstance;
  if (process.env.DATABASE_URL) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    dbInstance = { type: "pg", client };
    return dbInstance;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  dbInstance = { type: "supabase", client };
  return dbInstance;
}

async function upsertJobs(jobs) {
  const db = await getDb();
  if (db.type === "supabase") {
    const { error } = await db.client
      .from("jobs")
      .upsert(jobs, { onConflict: "source,external_id" });
    if (error) throw error;
    return;
  }
  for (const j of jobs) {
    await db.client.query(
      `INSERT INTO jobs (board_id, source, external_id, title, company, location, remote_type, visa_signal, scam_score, jd_text, apply_url, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (source, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         location = EXCLUDED.location,
         remote_type = EXCLUDED.remote_type,
         visa_signal = EXCLUDED.visa_signal,
         scam_score = EXCLUDED.scam_score,
         jd_text = EXCLUDED.jd_text,
         apply_url = EXCLUDED.apply_url,
         posted_at = EXCLUDED.posted_at,
         active = true,
         scraped_at = now()`,
      [
        j.board_id,
        j.source,
        j.external_id,
        j.title,
        j.company,
        j.location,
        j.remote_type,
        j.visa_signal,
        j.scam_score,
        j.jd_text,
        j.apply_url,
        j.posted_at,
      ]
    );
  }
}

async function main() {
  if (process.argv.includes("--fixtures")) return testWithFixtures();
  const db = await getDb();
  let boards = [];
  if (db.type === "supabase") {
    const { data, error } = await db.client
      .from("ats_boards")
      .select("id, ats_type, slug")
      .eq("active", true);
    if (error) throw error;
    boards = data || [];
  } else {
    const res = await db.client.query(
      "SELECT id, ats_type, slug FROM ats_boards WHERE active = true"
    );
    boards = res.rows || [];
  }

  let total = 0;
  for (const b of boards) {
    try {
      const jobs = await pollBoard(b);
      if (jobs.length) await upsertJobs(jobs.map((j) => ({ ...j, board_id: b.id })));
      if (db.type === "supabase") {
        await db.client
          .from("ats_boards")
          .update({ last_polled_at: new Date().toISOString() })
          .eq("id", b.id);
      } else {
        await db.client.query(
          "UPDATE ats_boards SET last_polled_at = now() WHERE id = $1",
          [b.id]
        );
      }
      total += jobs.length;
      console.log(`✔ ${b.ats_type}/${b.slug}: ${jobs.length} jobs`);
    } catch (e) {
      console.error(`✘ ${b.ats_type}/${b.slug}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 400)); // be polite
  }
  if (db.type === "pg") {
    await db.client.end();
  }
  console.log(`Done. ${total} jobs upserted.`);
}

// ── Offline fixture test ─────────────────────────────────────────

async function testWithFixtures() {
  const fs = await import("fs");
  let pass = 0,
    fail = 0;
  const cases = [
    ["greenhouse", "fixtures/greenhouse.json", "acme"],
    ["lever", "fixtures/lever.json", "globex"],
    ["ashby", "fixtures/ashby.json", "initech"],
  ];
  for (const [ats, file, slug] of cases) {
    const payload = JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
    const jobs = NORMALIZERS[ats](slug, payload).map(enrich);
    const ok =
      jobs.length > 0 &&
      jobs.every((j) => j.title && j.apply_url && j.external_id);
    console.log(
      `${ok ? "✔" : "✘"} ${ats}: ${jobs.length} normalized · sample:`,
      JSON.stringify(
        {
          title: jobs[0]?.title,
          visa: jobs[0]?.visa_signal,
          remote: jobs[0]?.remote_type,
          scam: jobs[0]?.scam_score,
        }
      )
    );
    ok ? pass++ : fail++;
  }
  // Signal unit checks
  const checks = [
    [visaSignal("We are unable to sponsor visas at this time"), "no-sponsor"],
    [visaSignal("H1B visa sponsorship available"), "sponsor"],
    [remoteType("Work from anywhere in the world", ""), "remote-global"],
    [scamScore("Pay a small registration fee and interview on WhatsApp") >= 3, true],
    [scamScore("Senior Accountant role, Big4, hybrid, CPA required"), 0],
  ];
  for (const [got, want] of checks) {
    const ok = got === want;
    console.log(`${ok ? "✔" : "✘"} signal check: got=${got} want=${want}`);
    ok ? pass++ : fail++;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
