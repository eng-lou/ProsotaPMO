function channelSettings(channel = 'preview') {
  if (!['stable', 'preview'].includes(channel)) throw new Error('Unknown Planner release channel')
  const stable = channel === 'stable'
  return {
    channel,
    title: `Prosota Planner ${stable ? 'Stable' : 'Preview'}`,
    appId: stable ? 'com.prosota.planner.stable' : 'com.prosota.desktop.preview',
    // Keep the existing preview folder/identity, so upgrading does not lose projects.
    dataFolder: stable ? 'Prosota Planner Stable' : 'Prosota Desktop Preview',
    executableName: stable ? 'Prosota Planner Stable' : 'Prosota Desktop Preview',
  }
}
module.exports = { channelSettings }
