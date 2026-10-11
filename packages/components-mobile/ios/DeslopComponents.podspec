Pod::Spec.new do |s|
  s.name           = 'DeslopComponents'
  s.version        = '1.0.0'
  s.summary        = 'SwiftUI views that @expo/ui lacks, shared by the mobile apps.'
  s.author         = 'mp281x'
  s.homepage       = 'https://github.com/MP281X/deslop'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoUI'
  s.dependency 'SwiftDraw'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.swift'
end
