import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { addResearchBrowserDomain } from './researchSettings.js'
import {
  readAutoUrl,
  type AutoReadSource,
  type AutoReadStatus,
  type AutoPageRenderer,
} from './readAutoUrl.js'
import type { ResearchReadStatus } from './readResearchUrl.js'

interface EvaluationSite {
  id: string
  category: 'public' | 'consent' | 'login' | 'loading' | 'captcha' | 'security' | 'site-error' | 'research-profile'
  url: string
  renderedTitle: string
  renderedHtml: string
  expectedSource: AutoReadSource
  expectedStatus: AutoReadStatus
  expectedAttention: boolean
  expectedBlockedStatus?: ResearchReadStatus
  expectedSnippet?: string
  allowedDomain?: string
  researchTitle?: string
  researchHtml?: string
}

function withWorkspace<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mim-web-eval-'))
  return Promise.resolve(fn(dir)).finally(() => {
    rmSync(dir, { recursive: true, force: true })
  })
}

function rendererReturning(html: string, title: string): AutoPageRenderer {
  return vi.fn(async ({ url }) => ({
    requestedUrl: url,
    finalUrl: `${url}#capture`,
    title,
    html,
  }))
}

function articleHtml(title: string, body: string): string {
  return `<main><article><h1>${title}</h1><p>${body}</p><table><tr><th>Signal</th><th>Value</th></tr><tr><td>Coverage</td><td>Readable</td></tr></table></article></main>`
}

function publicSite(id: string, url: string, title: string, body: string): EvaluationSite {
  return {
    id,
    category: 'public',
    url,
    renderedTitle: title,
    renderedHtml: articleHtml(title, body),
    expectedSource: 'rendered',
    expectedStatus: 'ok',
    expectedAttention: false,
    expectedSnippet: body,
  }
}

function blockedSite(
  id: string,
  category: EvaluationSite['category'],
  url: string,
  title: string,
  body: string,
  blockedStatus: ResearchReadStatus,
): EvaluationSite {
  return {
    id,
    category,
    url,
    renderedTitle: title,
    renderedHtml: `<main><h1>${title}</h1><p>${body}</p></main>`,
    expectedSource: 'rendered',
    expectedStatus: 'source_not_configured',
    expectedAttention: true,
    expectedBlockedStatus: blockedStatus,
    expectedSnippet: body,
  }
}

function researchProfileSite(
  id: string,
  url: string,
  renderedTitle: string,
  renderedBody: string,
  blockedStatus: ResearchReadStatus,
  researchTitle: string,
  researchBody: string,
): EvaluationSite {
  return {
    id,
    category: 'research-profile',
    url,
    renderedTitle,
    renderedHtml: `<main><h1>${renderedTitle}</h1><p>${renderedBody}</p></main>`,
    expectedSource: 'research-profile',
    expectedStatus: 'ok',
    expectedAttention: false,
    expectedBlockedStatus: blockedStatus,
    expectedSnippet: researchBody,
    allowedDomain: new URL(url).hostname,
    researchTitle,
    researchHtml: articleHtml(researchTitle, researchBody),
  }
}

const EVALUATION_SITES: EvaluationSite[] = [
  publicSite('wikipedia', 'https://en.wikipedia.org/wiki/Berlin', 'Berlin', 'Population history and transport links.'),
  publicSite('mdn', 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', 'Fetch API', 'Fetch provides an interface for fetching resources.'),
  publicSite('github-docs', 'https://docs.github.com/en/actions', 'GitHub Actions', 'Automate build, test, and deployment workflows.'),
  publicSite('nodejs', 'https://nodejs.org/api/fs.html', 'File system', 'The node file system module exposes callback and promise APIs.'),
  publicSite('npm', 'https://www.npmjs.com/package/vitest', 'vitest', 'A fast unit testing framework powered by Vite.'),
  publicSite('pypi', 'https://pypi.org/project/pdfminer.six/', 'pdfminer.six', 'Community maintained tool for extracting information from PDF documents.'),
  publicSite('arxiv', 'https://arxiv.org/abs/2401.00001', 'Research abstract', 'We introduce a benchmark for long-context retrieval.'),
  publicSite('pubmed', 'https://pubmed.ncbi.nlm.nih.gov/12345678/', 'PubMed record', 'The abstract describes methods, results, and conclusions.'),
  publicSite('clinicaltrials', 'https://clinicaltrials.gov/study/NCT00000000', 'Clinical study', 'Enrollment, interventions, and primary outcome measures are listed.'),
  publicSite('who', 'https://www.who.int/news-room/fact-sheets/detail/influenza-(seasonal)', 'Seasonal influenza', 'Symptoms include fever, cough, headache, muscle and joint pain.'),
  publicSite('govuk', 'https://www.gov.uk/guidance/driving-in-the-eu', 'Driving in the EU', 'Check documents and insurance before travelling.'),
  publicSite('eu', 'https://ec.europa.eu/commission/presscorner/detail/en/ip_26_001', 'Commission press corner', 'The Commission adopted a proposal and published supporting materials.'),
  publicSite('berlin-service', 'https://service.berlin.de/dienstleistung/120686/', 'Registration certificate', 'Appointments, documents, and fees are shown for the service.'),
  publicSite('bahnhof', 'https://www.bahnhof.de/berlin-ostkreuz/abfahrt', 'Berlin Ostkreuz departures', 'RB24 departures include Eberswalde and Senftenberg services.'),
  publicSite('regio-nordost', 'https://regio-nordost.de/aktuelle-meldungen/', 'DB Regio Nordost disruptions', 'Current traffic reports list route, period, and replacement service.'),
  publicSite('openstreetmap', 'https://wiki.openstreetmap.org/wiki/Key:railway', 'OpenStreetMap railway key', 'Railway tagging describes stations, platforms, and tracks.'),
  publicSite('hacker-news', 'https://news.ycombinator.com/item?id=1', 'Discussion thread', 'Comments are grouped by score, age, and nesting.'),
  publicSite('apnews', 'https://apnews.com/article/example', 'AP News article', 'The report includes dateline, summary, and source attribution.'),
  publicSite('nature', 'https://www.nature.com/articles/example', 'Nature article', 'The abstract summarizes experimental design and findings.'),
  publicSite('vercel', 'https://vercel.com/docs/functions', 'Vercel Functions', 'Functions run server-side code close to users.'),
  publicSite('stripe-docs', 'https://docs.stripe.com/payments', 'Stripe payments', 'PaymentIntents track the lifecycle of a customer payment.'),
  publicSite('react', 'https://react.dev/reference/react/useMemo', 'useMemo', 'Cache a calculation between re-renders.'),
  publicSite('vue', 'https://vuejs.org/guide/introduction.html', 'Vue introduction', 'Components combine declarative templates with reactive state.'),
  publicSite('typescript', 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html', 'Everyday Types', 'Type annotations describe primitives, arrays, and object shapes.'),
  publicSite('sqlite', 'https://sqlite.org/lang_select.html', 'SELECT statement', 'A SELECT statement reads data from one or more tables.'),
  blockedSite('google-search-consent', 'consent', 'https://www.google.com/search?q=rail+delays', 'Before you continue to Google', 'We value your privacy and ask you to review options.', 'consent_required'),
  blockedSite('youtube-consent', 'consent', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Before you continue', 'We value your privacy on this service.', 'consent_required'),
  blockedSite('reuters-consent', 'consent', 'https://www.reuters.com/world/', 'Privacy choices', 'We value your privacy and offer privacy choices.', 'consent_required'),
  blockedSite('guardian-consent', 'consent', 'https://www.theguardian.com/world', 'Privacy choices', 'Review privacy choices before continuing.', 'consent_required'),
  blockedSite('spiegel-consent', 'consent', 'https://www.spiegel.de/international/', 'Cookie settings', 'Please accept cookies to continue.', 'consent_required'),
  blockedSite('booking-consent', 'consent', 'https://www.booking.com/city/de/berlin.html', 'Cookie consent', 'Cookie consent is required before the page can be shown.', 'consent_required'),
  blockedSite('tripadvisor-consent', 'consent', 'https://www.tripadvisor.com/Restaurants-g187323-Berlin.html', 'Privacy choices', 'Choose privacy choices for personalized content.', 'consent_required'),
  blockedSite('airbnb-consent', 'consent', 'https://www.airbnb.com/s/Berlin/homes', 'Cookie preferences', 'Accept cookies to continue browsing stays.', 'consent_required'),
  blockedSite('linkedin-login', 'login', 'https://www.linkedin.com/in/example/', 'Sign in', 'Log in to continue to the profile.', 'login_required'),
  blockedSite('x-login', 'login', 'https://x.com/example', 'Sign in', 'Log in to continue.', 'login_required'),
  blockedSite('facebook-login', 'login', 'https://www.facebook.com/example', 'Log in', 'Please log in to continue.', 'login_required'),
  blockedSite('instagram-login', 'login', 'https://www.instagram.com/example/', 'Login', 'Login to continue viewing photos and videos.', 'login_required'),
  blockedSite('researchgate-login', 'login', 'https://www.researchgate.net/publication/example', 'Sign in', 'Please sign in to read the publication.', 'login_required'),
  blockedSite('ft-login', 'login', 'https://www.ft.com/content/example', 'Sign in', 'Sign in to continue reading.', 'login_required'),
  {
    id: 'linear-loading',
    category: 'loading',
    url: 'https://linear.app/shoulders/team/SHO/active',
    renderedTitle: 'Linear',
    renderedHtml: '<main>Loading…</main>',
    expectedSource: 'rendered',
    expectedStatus: 'partial',
    expectedAttention: false,
    expectedSnippet: 'Loading',
  },
  blockedSite('stackoverflow-security', 'security', 'https://stackoverflow.com/questions/1', 'Just a moment...', 'Performing security verification before loading the question.', 'security_verification'),
  blockedSite('reddit-captcha', 'captcha', 'https://www.reddit.com/r/programming/comments/example', 'Are you a robot?', 'Complete the captcha before continuing.', 'captcha_required'),
  blockedSite('ticketmaster-security', 'security', 'https://www.ticketmaster.com/event/example', 'Verify you are human', 'Security verification is required for this event page.', 'security_verification'),
  blockedSite('cloudflare-security', 'security', 'https://challenge.cloudflare.com/example', 'Checking your browser', 'Checking your browser before accessing the site.', 'security_verification'),
  blockedSite('yelp-captcha', 'captcha', 'https://www.yelp.com/biz/example', 'Human check', 'hCaptcha is required before the listing can be shown.', 'captcha_required'),
  blockedSite('sec-access-denied', 'site-error', 'https://www.sec.gov/ixviewer/doc/action', 'Access denied', 'Access denied while requesting the filing.', 'site_error'),
  researchProfileSite('maps-research', 'https://maps.google.com/search/coffee+ostkreuz', 'Before you continue to Google Maps', 'We value your privacy.', 'consent_required', 'Station coffee shops', 'Open now near Berlin Ostkreuz.'),
  researchProfileSite('slack-research', 'https://app.slack.com/client/T123/C456', 'Sign in', 'Log in to continue to Slack.', 'login_required', 'Project standup', 'Latest channel messages include blocker updates and launch tasks.'),
  researchProfileSite('notion-research', 'https://www.notion.so/workspace/research-notes', 'Sign in', 'Please sign in to continue.', 'login_required', 'Research Notes', 'The workspace note lists sources, claims, and follow-up questions.'),
  researchProfileSite('docs-google-research', 'https://docs.google.com/document/d/example/edit', 'Sign in', 'Sign in to continue to Google Docs.', 'login_required', 'Schedule Change Memo', 'The document describes revised train times and replacement buses.'),
]

describe('web reading evaluation set', () => {
  it('covers 50 representative websites with distinct hosts and blocker classes', () => {
    expect(EVALUATION_SITES).toHaveLength(50)
    expect(new Set(EVALUATION_SITES.map(site => new URL(site.url).hostname)).size).toBe(50)
    expect(new Set(EVALUATION_SITES.map(site => site.category))).toEqual(new Set([
      'public',
      'consent',
      'login',
      'loading',
      'captcha',
      'security',
      'site-error',
      'research-profile',
    ]))
  })

  it('matches expected content or recovery behavior across the full set', async () => {
    await withWorkspace(async (workspacePath) => {
      for (const site of EVALUATION_SITES) {
        if (site.allowedDomain) addResearchBrowserDomain(workspacePath, site.allowedDomain)
        const result = await readAutoUrl({
          url: site.url,
          max_chars: 100_000,
        }, {
          workspacePath,
          renderRendered: rendererReturning(site.renderedHtml, site.renderedTitle),
          renderResearch: site.researchHtml && site.researchTitle
            ? rendererReturning(site.researchHtml, site.researchTitle)
            : undefined,
          now: () => new Date('2026-06-25T16:00:00.000Z'),
        })

        expect(result.source, site.id).toBe(site.expectedSource)
        expect(result.status, site.id).toBe(site.expectedStatus)
        expect(result.attention_required, site.id).toBe(site.expectedAttention)
        if (site.expectedBlockedStatus && site.expectedStatus === 'source_not_configured') {
          expect(result.blocked_status, site.id).toBe(site.expectedBlockedStatus)
          expect(result.setup_url, site.id).toBe(`https://${new URL(site.url).hostname}`)
        }
        if (site.expectedSnippet) {
          expect(result.content, site.id).toContain(site.expectedSnippet)
        }
      }
    })
  })
})
