import { Client } from "pg";

const FEEDS = {
  greenhouse: (slug) =>
    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};

function stripHtml(s) {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

const NORMALIZERS = { greenhouse: normGreenhouse, lever: normLever, ashby: normAshby };

const SPONSOR_POS = /\b(visa sponsorship (is )?available|we sponsor|will sponsor|h-?1b|sponsorship provided|work permit support)\b/i;
const SPONSOR_NEG = /\b(no (visa )?sponsorship|not (able|willing) to sponsor|must be (legally )?authori[sz]ed to work|without sponsorship|unable to sponsor|cannot sponsor|right to work .{0,20}required|citizens? (or|and) permanent residents? only)\b/i;

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

function enrich(job) {
  return {
    ...job,
    visa_signal: visaSignal(job.jd_text),
    remote_type: remoteType(job.jd_text, job.location),
    scam_score: scamScore(job.jd_text),
  };
}

export default async function handler(req, res) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: "DATABASE_URL not configured" });

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    const boardsRes = await client.query("SELECT id, ats_type, slug FROM ats_boards WHERE active = true");
    const boards = boardsRes.rows || [];
    let total = 0;

    for (const b of boards) {
      const url = FEEDS[b.ats_type]?.(b.slug);
      if (!url) continue;
      try {
        const fetchRes = await fetch(url, { headers: { "User-Agent": "JobPilot/1.0" } });
        if (!fetchRes.ok) continue;
        const payload = await fetchRes.json();
        const jobs = NORMALIZERS[b.ats_type](b.slug, payload).map(enrich);

        for (const j of jobs) {
          await client.query(
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
            [b.id, j.source, j.external_id, j.title, j.company, j.location, j.remote_type, j.visa_signal, j.scam_score, j.jd_text, j.apply_url, j.posted_at]
          );
        }
        await client.query("UPDATE ats_boards SET last_polled_at = now() WHERE id = $1", [b.id]);
        total += jobs.length;
      } catch (err) {
        console.error(`Error polling ${b.slug}:`, err.message);
      }
    }

    await client.end();
    return res.status(200).json({ success: true, message: `Polled and upserted ${total} jobs.` });
  } catch (err) {
    if (client) await client.end().catch(() => {});
    return res.status(500).json({ error: err.message });
  }
}
