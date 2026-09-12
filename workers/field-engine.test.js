// Extract FIELD_RULES from field-engine.js and test classification signatures
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(join(__dirname, "../extension/field-engine.js"), "utf8");
const rulesBlock = src.match(/const FIELD_RULES = \[([\s\S]*?)\n  \];/)[1];
const FIELD_RULES = eval("[" + rulesBlock + "]");
const classify = (sig) => {
  for (const [f, re] of FIELD_RULES) if (re.test(sig)) return f;
  return null;
};
const cases = [
  ["first name *", "first_name"],
  ["candidate-surname", "last_name"],
  ["e-mail address", "email"],
  ["phone number", "phone"],
  ["are you legally authorized to work in the united states?", "work_auth"],
  ["will you now or in the future require sponsorship for employment visa status (e.g. h-1b)?", "sponsorship"],
  ["expected ctc", "salary"],
  ["notice period (days)", "notice_period"],
  ["cover letter", "cover_letter"],
  ["how did you hear about this job?", "how_heard"],
  ["linkedin profile", "linkedin"],
  ["upload resume/cv", "resume"],
  ["gender identity (optional)", "gender"],
  ["veteran status", "veteran"],
  ["years of relevant experience", "years_experience"],
  ["favourite color", null],
];
let pass = 0;
for (const [sig, want] of cases) {
  const got = classify(sig.toLowerCase());
  const ok = got === want;
  console.log(`${ok ? "✔" : "✘"} "${sig}" → ${got} (want ${want})`);
  if (ok) pass++;
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
