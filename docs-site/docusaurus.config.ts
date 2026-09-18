import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// VyomDesk documentation site (P1.15) - docs/ content surfaced via Docusaurus.
// Note: Docusaurus strips the "NN-" filename prefixes, so routes are e.g.
// /docs/ARCHITECTURE (not /docs/02-ARCHITECTURE).

const config: Config = {
  title: 'VyomDesk',
  tagline: 'Free & open-source remote monitoring, management & remote desktop',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://vyomdesk.online',
  baseUrl: '/',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: 'docs',
          path: '../docs',
          include: ['**/*.md', '**/*.mdx'],
          // 13 is the internal living status doc (mojibake history + raw
          // angle brackets that break MDX); public site ships the rest.
          exclude: ['**/node_modules/**', '13-IMPLEMENTATION-STATUS.md'],
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
      defaultMode: 'dark',
    },
    navbar: {
      title: 'VyomDesk',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/vyomdesk/vyomdesk',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Executive Summary', to: '/docs/EXECUTIVE-SUMMARY'},
            {label: 'Architecture', to: '/docs/ARCHITECTURE'},
            {label: 'API Spec', to: '/docs/API-SPEC'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'Roadmap', to: '/docs/ROADMAP'},
            {label: 'Deployment', to: '/docs/DEPLOYMENT'},
            {label: 'Legal', to: '/docs/LEGAL-COPYRIGHT'},
          ],
        },
      ],
      copyright: `VyomDesk — Apache-2.0. Copyright © ${new Date().getFullYear()}. Includes software developed as part of MeshCentral (Apache-2.0, see NOTICE).`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;