Pod::Spec.new do |s|
  s.name = 'MerlinEngine'
  s.version = '0.1.0'
  s.summary = 'Merlin Chromium host interface for the React Native shell'
  s.homepage = 'https://github.com/kylianmarceau/merlin'
  s.license = { :type => 'BSD-3-Clause' }
  s.author = 'Merlin contributors'
  s.source = { :path => '.' }
  s.platform = :osx, '14.0'
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = 'macos/**/*.{h,m,mm,swift}', 'include/*.h'
  s.public_header_files = 'macos/MerlinEngineBridge.h', 'include/*.h'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AppKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20' }
end
