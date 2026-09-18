import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

/**
 * VyomDesk docs landing page - quickstart + feature highlights,
 * linking into the planning/spec docs surfaced by Docusaurus.
 */

const features = [
  {
    title: 'Remote Desktop',
    description:
      'Browser-based remote desktop over the VyomLink relay: JPEG streaming with adaptive quality, multi-monitor, live mouse/keyboard input. No client install for the viewer.',
    link: '/docs/FEATURES',
  },
  {
    title: 'Agent-first security',
    description:
      'Ed25519 challenge-response agent auth (TOFU on first contact), one-time relay tokens, Argon2id passwords, per-group rights bitmasks enforced server-side.',
    link: '/docs/SECURITY',
  },
  {
    title: 'Self-host or cloud',
    description:
      'Single server + web + Docker compose; SQLite for small fleets, Postgres for scale. Free forever, Apache-2.0, no vendor lock-in.',
    link: '/docs/DEPLOYMENT',
  },
];

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — free & open-source remote desktop`}
      description="VyomDesk: free MeshCentral-style remote monitoring, management and remote desktop. Self-hostable, Apache-2.0.">
      <main className={clsx('container', styles.heroBanner)}>
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p>
          MeshCentral-class features — device groups &amp; permissions, terminal (ConPTY),
          file manager, quick-support 9-digit codes, guest share links, alert rules and
          session recording — free and open source, in the browser, with no per-device fees.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/EXECUTIVE-SUMMARY">
            Get started
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/ARCHITECTURE">
            Architecture
          </Link>
        </div>
        <section className={clsx('row', styles.features)}>
          {features.map((f) => (
            <article key={f.title} className="col col--4">
              <h3>{f.title}</h3>
              <p>{f.description}</p>
              <Link to={f.link}>Read more →</Link>
            </article>
          ))}
        </section>
      </main>
    </Layout>
  );
}