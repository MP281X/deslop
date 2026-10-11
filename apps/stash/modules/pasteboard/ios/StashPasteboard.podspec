Pod::Spec.new do |s|
  s.name           = 'StashPasteboard'
  s.version        = '1.0.0'
  s.summary        = 'What the clipboard holds, without reading it.'
  s.description    = 'Tells stash whether the clipboard changed and holds a link or an image, so iOS shows no paste banner.'
  s.author         = 'mp281x'
  s.homepage       = 'https://github.com/MP281X/deslop'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.swift'
end
