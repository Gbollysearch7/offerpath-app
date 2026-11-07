"use client";

import { useState, useTransition, type ReactNode } from "react";
import { deleteInstitutionContact, deleteInstitutionResource, deleteProgrammeGroup, saveInstitutionContact, saveInstitutionResource, saveInstitutionSettings, saveProgrammeGroup, stopReportSharing } from "@/app/actions/adviser";
import { FormError } from "@/components/client";
import type { AdviserScope, InstitutionConfig } from "@/lib/institution/types";

const field = "min-h-11 rounded-[14px] border border-edge bg-white px-3 text-[15px] font-normal";
const area = "resize-y rounded-[14px] border border-edge p-3 text-[15px] font-normal";
const label = "flex min-w-0 flex-1 basis-[220px] flex-col gap-1.5 text-sm font-medium";
const primary = "min-h-11 self-start rounded-full border-0 bg-black px-[18px] text-sm font-medium text-white hover:bg-ink-2 disabled:opacity-50";
const quiet = "min-h-10 rounded-full border border-edge bg-white px-4 text-sm text-black hover:bg-paper disabled:opacity-50";

function Card({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-3xl bg-white px-6 py-[22px]">
      <h2 id={id} className="m-0 font-mono text-xs font-normal tracking-[0.04em] text-subtle">
        {title}
      </h2>
      {intro && <p className="m-0 text-sm leading-relaxed text-muted">{intro}</p>}
      {children}
    </section>
  );
}

/** Runs an action and reports how it went, in one place, for every form on this page. */
function useSave() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, ok: string, then?: () => void) =>
    start(async () => {
      setError(null);
      setStatus(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        setStatus(ok);
        then?.();
      }
    });
  const message = (
    <>
      <FormError message={error} />
      {status && (
        <p role="status" className="m-0 text-sm text-brand">
          {status}
        </p>
      )}
    </>
  );
  return { run, pending, message };
}

const list = (v: string) => v.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

export function InstitutionManager({ config, adviserCvOn }: { config: InstitutionConfig; adviserCvOn: boolean }) {
  const groupName = (id: string | null) => (id ? (config.groups.find((g) => g.id === id)?.name ?? "A group") : "Everyone");
  return (
    <>
      <SettingsForm config={config} />
      <AccessCard config={config} adviserCvOn={adviserCvOn} />
      <Card id="group-h" title="PROGRAMME GROUPS" intro="A group is the faculties and courses you list, spelled as in your imported records. Students are in a group automatically. Groups decide which resources students see and, under the policy above, which students an adviser sees.">
        {config.groups.map((g) => (
          <Row key={g.id} title={g.name} sub={[...g.faculties, ...g.courses].join(", ")} onDelete={() => deleteProgrammeGroup(g.id)} removed={`${g.name} removed.`} name={g.name} />
        ))}
        <GroupForm />
      </Card>
      <Card id="res-h" title="RESOURCES" intro="Links students see on their careers service page, and beside their CV report. Choose a group to show one only to those students.">
        {config.resources.map((r) => (
          <Row key={r.id} title={r.title} sub={`${groupName(r.groupId)}${r.active ? "" : " · hidden"} · ${r.url}`} onDelete={() => deleteInstitutionResource(r.id)} removed={`${r.title} removed.`} name={r.title} />
        ))}
        <ResourceForm groups={config.groups} />
      </Card>
      <Card id="con-h" title="SERVICE CONTACTS" intro="How students reach you. Advisers can also choose one of these when they suggest a referral.">
        {config.contacts.map((c) => (
          <Row key={c.id} title={c.label} sub={[c.purpose, c.email, c.phone, c.url, c.hours].filter(Boolean).join(" · ")} onDelete={() => deleteInstitutionContact(c.id)} removed={`${c.label} removed.`} name={c.label} />
        ))}
        <ContactForm />
      </Card>
    </>
  );
}

function Row({ title, sub, onDelete, removed, name }: { title: string; sub: string; onDelete: () => Promise<{ error?: string }>; removed: string; name: string }) {
  const { run, pending, message } = useSave();
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-[220px]">
          <p className="m-0 text-[15px]">{title}</p>
          <p className="m-0 text-[13px] break-words text-subtle">{sub}</p>
        </div>
        <button type="button" disabled={pending} onClick={() => run(onDelete, removed)} className={quiet} aria-label={`Remove ${name}`}>
          Remove
        </button>
      </div>
      {message}
    </div>
  );
}

function SettingsForm({ config }: { config: InstitutionConfig }) {
  const [brandName, setBrandName] = useState(config.brandName ?? "");
  const [brandColour, setBrandColour] = useState(config.brandColour ?? "");
  const [welcome, setWelcome] = useState(config.welcome ?? "");
  const [adviserScope, setScope] = useState<AdviserScope>(config.adviserScope);
  const { run, pending, message } = useSave();
  return (
    <Card id="brand-h" title="BRANDING AND ADVISER POLICY">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveInstitutionSettings({ brandName, brandColour, welcome, adviserScope }), "Saved.");
        }}
      >
        <div className="flex flex-wrap gap-3">
          <label className={label}>
            Name shown to students
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={80} placeholder={config.universityName} className={field} />
          </label>
          <label className={label}>
            Brand colour (#RRGGBB, dark enough to read on white)
            <input value={brandColour} onChange={(e) => setBrandColour(e.target.value)} maxLength={7} placeholder="#36604E" className={field} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Welcome message
          <textarea value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={3} maxLength={600} className={area} />
        </label>
        <label className={label}>
          Which students advisers can see
          <select value={adviserScope} onChange={(e) => setScope(e.target.value as AdviserScope)} className={field}>
            <option value="assigned">Only those in the programme groups given to them</option>
            <option value="all">Every student who shares their progress</option>
          </select>
        </label>
        {message}
        <button type="submit" disabled={pending} className={primary}>
          Save
        </button>
      </form>
    </Card>
  );
}

function AccessCard({ config, adviserCvOn }: { config: InstitutionConfig; adviserCvOn: boolean }) {
  const { run, pending, message } = useSave();
  return (
    <Card id="access-h" title="ACCESS POLICIES">
      <dl className="m-0 flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium">Student-made report links: {config.reportSharing ? "on" : "off"}</dt>
          <dd className="m-0 mt-1 text-muted">
            {config.reportSharing ? "Students can create expiring links to a limited summary of a CV review. You can stop this at any time; existing links then stop working on their next request. Switching it back on needs Offerpath." : "Students can't create links. Turning this on isn't available here: ask Offerpath, which agrees it with you first."}
          </dd>
          {config.reportSharing && (
            <dd className="m-0 mt-2">
              <button type="button" disabled={pending} onClick={() => run(stopReportSharing, "Report links are now off.")} className={quiet}>
                Stop report links
              </button>
            </dd>
          )}
        </div>
        <div>
          <dt className="font-medium">Advisers opening original CV files: {adviserCvOn ? "on" : "off"}</dt>
          <dd className="m-0 mt-1 text-muted">Not a setting you can change here. It stays off until a legal review has been completed, and even then only applies to students who opt in.</dd>
        </div>
        <div>
          <dt className="font-medium">The CV score</dt>
          <dd className="m-0 mt-1 text-muted">The same for every university. No setting can change it, and advisers can record that they disagree but can&apos;t alter it.</dd>
        </div>
      </dl>
      {message}
    </Card>
  );
}

function GroupForm() {
  const [name, setName] = useState("");
  const [faculties, setFaculties] = useState("");
  const [courses, setCourses] = useState("");
  const { run, pending, message } = useSave();
  return (
    <form
      className="flex flex-col gap-3 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveProgrammeGroup({ name, faculties: list(faculties), courses: list(courses) }), "Group added.", () => {
          setName("");
          setFaculties("");
          setCourses("");
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className={label}>
          Group name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} />
        </label>
        <label className={label}>
          Faculties (comma-separated)
          <input value={faculties} onChange={(e) => setFaculties(e.target.value)} className={field} />
        </label>
        <label className={label}>
          Courses (comma-separated)
          <input value={courses} onChange={(e) => setCourses(e.target.value)} className={field} />
        </label>
      </div>
      {message}
      <button type="submit" disabled={pending || name.trim().length < 2} className={primary}>
        Add group
      </button>
    </form>
  );
}

function ResourceForm({ groups }: { groups: InstitutionConfig["groups"] }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("");
  const { run, pending, message } = useSave();
  return (
    <form
      className="flex flex-col gap-3 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveInstitutionResource({ title, url, description, groupId: groupId || null, active: true }), "Resource added.", () => {
          setTitle("");
          setUrl("");
          setDescription("");
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className={label}>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
        </label>
        <label className={label}>
          Web address (https://)
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} className={field} />
        </label>
        <label className={label}>
          Who sees it
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={field}>
            <option value="">Everyone at the university</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Short description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={400} className={area} />
      </label>
      {message}
      <button type="submit" disabled={pending || title.trim().length < 2 || !url} className={primary}>
        Add resource
      </button>
    </form>
  );
}

function ContactForm() {
  const empty = { label: "", purpose: "", email: "", phone: "", url: "", hours: "" };
  const [c, setC] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });
  const { run, pending, message } = useSave();
  return (
    <form
      className="flex flex-col gap-3 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveInstitutionContact({ ...c, email: c.email || null, phone: c.phone || null, url: c.url || null, hours: c.hours || null }), "Contact added.", () => setC(empty));
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className={label}>
          Name of the service
          <input value={c.label} onChange={set("label")} maxLength={80} className={field} />
        </label>
        <label className={label}>
          What it&apos;s for
          <input value={c.purpose} onChange={set("purpose")} maxLength={300} className={field} />
        </label>
        <label className={label}>
          Email
          <input type="email" value={c.email} onChange={set("email")} maxLength={200} className={field} />
        </label>
        <label className={label}>
          Phone
          <input value={c.phone} onChange={set("phone")} maxLength={40} className={field} />
        </label>
        <label className={label}>
          Web address (https://)
          <input type="url" value={c.url} onChange={set("url")} maxLength={500} className={field} />
        </label>
        <label className={label}>
          Opening hours
          <input value={c.hours} onChange={set("hours")} maxLength={120} className={field} />
        </label>
      </div>
      {message}
      <button type="submit" disabled={pending || c.label.trim().length < 2} className={primary}>
        Add contact
      </button>
    </form>
  );
}
