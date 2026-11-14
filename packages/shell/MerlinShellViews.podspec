Pod::Spec.new do |s|
  s.name = 'MerlinShellViews'
  s.version = '0.1.0'
  s.summary = 'AppKit views and menus for the Merlin React Native shell'
  s.homepage = 'https://github.com/kylianmarceau/merlin'
  s.license = { :type => 'BSD-3-Clause' }
  s.author = 'Merlin contributors'
  s.source = { :path => '.' }
  s.platform = :osx, '14.0'
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = 'macos/**/*.swift'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AppKit', 'SwiftUI', 'ServiceManagement', 'UniformTypeIdentifiers'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
