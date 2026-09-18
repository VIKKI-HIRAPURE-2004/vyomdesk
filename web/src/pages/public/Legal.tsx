/**
 * Terms of Service + Privacy Policy (public).
 * Legal copy adapted from docs/09-LEGAL-COPYRIGHT.md (public-cloud section).
 * Plain route (no layout) so it is presentable pre-auth.
 */

const sections = [
  {
    title: "1. Acceptance",
    body: "By creating a VyomDesk account you agree to these Terms of Service and the Privacy Policy. If you do not agree, do not use the service.",
  },
  {
    title: "2. The Service",
    body: "VyomDesk provides remote monitoring and remote desktop tooling. The software is open source (Apache-2.0); the public cloud instance is provided free of charge, as-is, without any warranty (express or implied).",
  },
  {
    title: "3. Acceptable Use",
    body: "You may only add devices you own or are authorized to manage. Using VyomDesk to access machines without the owner's consent, or for any activity prohibited by applicable law, is strictly forbidden and will result in immediate account termination.",
  },
  {
    title: "4. Data",
    body: "Connection logs and device metadata are stored on our infrastructure. Remote sessions are relayed end-to-end between agent and browser; VyomDesk does not store session content unless session recording is explicitly enabled by an administrator.",
  },
  {
    title: "5. Availability",
    body: "The free public cloud is provided best-effort. No uptime guarantee applies. Keep backups of any data you care about.",
  },
  {
    title: "6. Termination",
    body: "Accounts violating these terms, or used for abuse, may be suspended or terminated at any time without notice.",
  },
  {
    title: "7. Changes",
    body: "These terms may be updated; continued use after an update constitutes acceptance. The current version is always at /legal.",
  },
  {
    title: "8. Contact",
    body: "Abuse reports: abuse@vyomdesk.online · Security disclosures: security@vyomdesk.online",
  },
];

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold">
          Vyom<span className="text-brand-400">Desk</span> — Terms &amp; Privacy
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          VyomDesk (vyomdesk.online) · Free &amp; open-source remote desktop
        </p>

        <div className="mt-8 space-y-6">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-lg font-semibold text-slate-100">{s.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{s.body}</p>
            </section>
          ))}
        </div>

        <p className="mt-10 text-xs text-slate-500 border-t border-slate-800 pt-4">
          VyomDesk includes concepts adapted from MeshCentral (Apache-2.0, Copyright Intel Corp.)
          — see the NOTICE file in the repository. VyomDesk is not affiliated with Intel or the
          MeshCentral project.
        </p>

        <div className="mt-6 text-center">
          <a href="/register" className="text-sm text-brand-400 hover:underline">
            ← Back to sign up
          </a>
        </div>
      </div>
    </div>
  );
}