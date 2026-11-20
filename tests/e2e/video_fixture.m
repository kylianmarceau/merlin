// Test-only. Writes a short MP4 with a picture and a sound track, for the
// tests that need a video WebKit can play with sound (test_auto_pip.py): a
// canvas stream won't do there, and the repository keeps no media files. The
// harness compiles this with clang, as it does background_app.m.
//
//   video_fixture <output.mp4>
//
// Two seconds of 320x180 H.264 changing colour, with a quiet 440 Hz AAC tone.

#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>
#include <math.h>

static const int kWidth = 320, kHeight = 180, kFps = 30, kSeconds = 2, kRate = 44100;

static CVPixelBufferRef Frame(CVPixelBufferPoolRef pool, int n) {
  CVPixelBufferRef buffer = NULL;
  CVPixelBufferPoolCreatePixelBuffer(NULL, pool, &buffer);
  CVPixelBufferLockBaseAddress(buffer, 0);
  uint8_t* base = CVPixelBufferGetBaseAddress(buffer);
  size_t stride = CVPixelBufferGetBytesPerRow(buffer);
  uint8_t r = (uint8_t)(n * 8), g = (uint8_t)(255 - n * 4), b = 160;
  for (int y = 0; y < kHeight; ++y) {
    for (int x = 0; x < kWidth; ++x) {
      uint8_t* p = base + y * stride + x * 4;  // BGRA
      p[0] = b; p[1] = g; p[2] = r; p[3] = 255;
    }
  }
  CVPixelBufferUnlockBaseAddress(buffer, 0);
  return buffer;
}

static CMSampleBufferRef Tone(CMAudioFormatDescriptionRef format, int64_t start, int count) {
  int16_t* samples = malloc(count * sizeof(int16_t));
  for (int i = 0; i < count; ++i) samples[i] = (int16_t)(3000 * sin(2 * M_PI * 440 * (start + i) / kRate));
  CMBlockBufferRef block = NULL;
  CMBlockBufferCreateWithMemoryBlock(NULL, samples, count * sizeof(int16_t), kCFAllocatorMalloc, NULL, 0,
                                     count * sizeof(int16_t), 0, &block);
  CMSampleBufferRef sample = NULL;
  CMAudioSampleBufferCreateReadyWithPacketDescriptions(NULL, block, format, count, CMTimeMake(start, kRate), NULL,
                                                       &sample);
  CFRelease(block);
  return sample;
}

int main(int argc, char** argv) {
  @autoreleasepool {
    if (argc != 2) {
      fprintf(stderr, "usage: video_fixture <output.mp4>\n");
      return 2;
    }
    NSURL* url = [NSURL fileURLWithPath:@(argv[1])];
    [NSFileManager.defaultManager removeItemAtURL:url error:nil];
    NSError* error = nil;
    AVAssetWriter* writer = [AVAssetWriter assetWriterWithURL:url fileType:AVFileTypeMPEG4 error:&error];
    if (!writer) {
      fprintf(stderr, "%s\n", error.description.UTF8String);
      return 1;
    }
    AVAssetWriterInput* video = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:@{
      AVVideoCodecKey : AVVideoCodecTypeH264, AVVideoWidthKey : @(kWidth), AVVideoHeightKey : @(kHeight)
    }];
    AVAssetWriterInputPixelBufferAdaptor* adaptor = [AVAssetWriterInputPixelBufferAdaptor
        assetWriterInputPixelBufferAdaptorWithAssetWriterInput:video sourcePixelBufferAttributes:@{
          (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
          (id)kCVPixelBufferWidthKey : @(kWidth), (id)kCVPixelBufferHeightKey : @(kHeight)
        }];
    AVAssetWriterInput* audio = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio outputSettings:@{
      AVFormatIDKey : @(kAudioFormatMPEG4AAC), AVSampleRateKey : @(kRate), AVNumberOfChannelsKey : @1,
      AVEncoderBitRateKey : @64000
    }];
    video.expectsMediaDataInRealTime = NO;
    audio.expectsMediaDataInRealTime = NO;
    [writer addInput:video];
    [writer addInput:audio];
    if (![writer startWriting]) {
      fprintf(stderr, "%s\n", writer.error.description.UTF8String);
      return 1;
    }
    [writer startSessionAtSourceTime:kCMTimeZero];

    AudioStreamBasicDescription pcm = {.mSampleRate = kRate, .mFormatID = kAudioFormatLinearPCM,
                                       .mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
                                       .mBytesPerPacket = 2, .mFramesPerPacket = 1, .mBytesPerFrame = 2,
                                       .mChannelsPerFrame = 1, .mBitsPerChannel = 16};
    CMAudioFormatDescriptionRef format = NULL;
    CMAudioFormatDescriptionCreate(NULL, &pcm, 0, NULL, 0, NULL, NULL, &format);

    // Interleave the tracks so neither input waits for the other.
    int frame = 0;
    int64_t sample = 0;
    const int64_t samples = (int64_t)kRate * kSeconds;
    const int chunk = kRate / kFps;
    while (frame < kFps * kSeconds || sample < samples) {
      if (frame < kFps * kSeconds && video.readyForMoreMediaData) {
        CVPixelBufferRef buffer = Frame(adaptor.pixelBufferPool, frame);
        [adaptor appendPixelBuffer:buffer withPresentationTime:CMTimeMake(frame, kFps)];
        CVPixelBufferRelease(buffer);
        ++frame;
        if (frame == kFps * kSeconds) [video markAsFinished];
      }
      if (sample < samples && audio.readyForMoreMediaData) {
        int count = (int)MIN((int64_t)chunk, samples - sample);
        CMSampleBufferRef buffer = Tone(format, sample, count);
        [audio appendSampleBuffer:buffer];
        CFRelease(buffer);
        sample += count;
        if (sample == samples) [audio markAsFinished];
      }
      if (!video.readyForMoreMediaData && !audio.readyForMoreMediaData) usleep(1000);
    }
    CFRelease(format);
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [writer finishWritingWithCompletionHandler:^{
      dispatch_semaphore_signal(done);
    }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    if (writer.status != AVAssetWriterStatusCompleted) {
      fprintf(stderr, "%s\n", writer.error.description.UTF8String);
      return 1;
    }
  }
  return 0;
}
