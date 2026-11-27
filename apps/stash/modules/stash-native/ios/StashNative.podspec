Pod::Spec.new do |s|
  s.name = 'StashNative'
  s.version = '1.0.0'
  s.summary = 'Stash share uploads and Live Activity tokens.'
  s.author = 'mp281x'
  s.homepage = 'https://github.com/MP281X/deslop'
  s.platforms = { :ios => '26.0' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
