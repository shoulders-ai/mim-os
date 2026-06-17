import { notarize } from '@electron/notarize'

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('Skipping notarization — APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD not set')
    return
  }

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  console.log(`Notarizing ${appPath}…`)

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })

  console.log('Notarization complete')
}
