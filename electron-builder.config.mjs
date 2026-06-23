/**
 * electron-builder configuration
 * https://www.electron.build/configuration
 */

// Azure Trusted Signing for Windows. Only engaged when service-principal
// credentials are present (CI), so local/unsigned smoke builds still work.
// Auth is read from AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
// by DefaultAzureCredential. The leaf cert is short-lived and rotates every
// few days; the signature is timestamped so it stays valid after expiry.
const azureSign = process.env.AZURE_CLIENT_ID
  ? {
      azureSignOptions: {
        publisherName: 'PRIORB UG',
        endpoint: 'https://plc.codesigning.azure.net/',
        codeSigningAccountName: 'shoulders',
        certificateProfileName: process.env.AZURE_CERT_PROFILE_NAME || 'mim-1',
      },
    }
  : {}

export default {
  appId: 'com.priorb.mim',
  productName: 'Mim',
  directories: {
    output: 'dist-installers',
    buildResources: 'build',
  },
  files: [
    'out/**/*',
    'skills/**/*',
    'resources/**/*',
    'sdk/**/*',
    '!sdk/**/*.test.*',
    '!resources/docx-worker/**/*',
  ],
  extraResources: [
    {
      from: 'resources/docx-worker/${os}-${arch}/',
      to: 'docx-worker/${os}-${arch}/',
      filter: ['**/*'],
    },
  ],
  asar: true,
  asarUnpack: [
    'node_modules/node-pty/**',
    'node_modules/better-sqlite3/**',
    'node_modules/keytar/**',
    'node_modules/sharp/**',
  ],

  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.icns',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
  },
  dmg: {
    sign: false,
  },

  win: {
    icon: 'build/icon.ico',
    target: [
      { target: 'nsis', arch: ['x64'] },
    ],
    ...azureSign,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
  },

  linux: {
    icon: 'resources/icon.png',
    category: 'Development',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'tar.gz', arch: ['x64'] },
    ],
    executableArgs: ['--class=mim'],
  },
  deb: {
    depends: ['libsecret-1-0', 'libnotify4'],
    publish: null,
  },

  afterSign: 'scripts/notarize.mjs',

  publish: {
    provider: 'github',
    owner: 'shoulders-ai',
    repo: 'mim-os',
  },
}
