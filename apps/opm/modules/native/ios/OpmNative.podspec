Pod::Spec.new do |s|
  s.name           = 'OpmNative'
  s.version        = '1.0.0'
  s.summary        = 'The page reader, covers and progress disc that Expo UI lacks.'
  s.author         = 'mp281x'
  s.homepage       = 'https://github.com/MP281X/deslop'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoUI'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.swift'
end
