Pod::Spec.new do |s|
  s.name = 'MerlinWebKit'
  s.version = '0.1.0'
  s.summary = 'WebKit pages for sites Chromium cannot play, such as Netflix'
  s.homepage = 'https://github.com/kylianmarceau/merlin'
  s.license = { :type => 'BSD-3-Clause' }
  s.author = 'Merlin contributors'
  s.source = { :path => '.' }
  s.platform = :osx, '14.0'
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = 'macos/**/*.swift'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AppKit', 'WebKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
