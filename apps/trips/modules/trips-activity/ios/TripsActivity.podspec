Pod::Spec.new do |s|
  s.name = 'TripsActivity'
  s.version = '0.1.0'
  s.summary = 'Trips Live Activity push token'
  s.homepage = 'https://github.com/MP281X/deslop'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'MP281X'
  s.source = { :git => 'https://github.com/MP281X/deslop.git' }
  s.platform = :ios, '26.0'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit', 'UIKit'
  s.source_files = '*.swift'
end
