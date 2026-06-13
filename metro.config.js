const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const { resolve } = require('metro-resolver')

const config = getDefaultConfig(__dirname)

// Metro 0.84 (Expo SDK 56) changed context.resolveRequest to point to the
// custom resolver itself, not Metro's built-in resolver. NativeWind's
// resolveRequest does `originalResolver ?? context.resolveRequest` — without
// a pre-set originalResolver it recurses infinitely. We break the cycle by
// providing a base resolver that always calls Metro's built-in resolve().
config.resolver.resolveRequest = (context, moduleName, platform) =>
  resolve({ ...context, resolveRequest: null }, moduleName, platform)

module.exports = withNativeWind(config, { input: './global.css' })
