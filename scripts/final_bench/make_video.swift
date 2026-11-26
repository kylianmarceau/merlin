// Writes a 1080p30 H.264 test clip with moving content (no audio):
//   swiftc -O make_video.swift -o make_video && ./make_video out.mp4 [seconds]
import AVFoundation
import CoreGraphics
let out = URL(fileURLWithPath: CommandLine.arguments[1])
let seconds = CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2])! : 60
try? FileManager.default.removeItem(at: out)
let w = 1920, h = 1080, fps = 30
let writer = try! AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 8_000_000]])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h])
writer.add(input); writer.startWriting(); writer.startSession(atSourceTime: .zero)
for f in 0..<(seconds * fps) {
  while !input.isReadyForMoreMediaData { usleep(1000) }
  var pb: CVPixelBuffer?; CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
  CVPixelBufferLockBaseAddress(pb!, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb!), width: w, height: h, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pb!), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  let t = Double(f) / Double(fps)
  ctx.setFillColor(red: 0.5 + 0.5 * sin(t), green: 0.5 + 0.5 * sin(t * 1.3 + 2), blue: 0.5 + 0.5 * sin(t * 0.7 + 4), alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  for i in 0..<40 {
    let x = (Double(w) / 2) + 800 * sin(t * (0.5 + Double(i) * 0.05) + Double(i)), y = (Double(h) / 2) + 450 * cos(t * (0.7 + Double(i) * 0.03) + Double(i) * 2)
    ctx.setFillColor(red: Double(i % 5) / 5, green: Double(i % 7) / 7, blue: Double(i % 3) / 3, alpha: 0.8)
    ctx.fillEllipse(in: CGRect(x: x - 60, y: y - 60, width: 120, height: 120))
  }
  CVPixelBufferUnlockBaseAddress(pb!, [])
  adaptor.append(pb!, withPresentationTime: CMTime(value: CMTimeValue(f), timescale: CMTimeScale(fps)))
}
input.markAsFinished(); let s = DispatchSemaphore(value: 0); writer.finishWriting { s.signal() }; s.wait()
print(writer.status == .completed ? "ok" : "failed \(String(describing: writer.error))")
