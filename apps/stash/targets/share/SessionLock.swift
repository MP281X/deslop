import Darwin
import Foundation

enum SessionLock {
  static func acquire(group: String) async throws -> Int32 {
    try await Task.detached(priority: .userInitiated) {
      guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
        throw CocoaError(.featureUnsupported)
      }
      let descriptor = open(container.appendingPathComponent("auth.lock").path, O_CREAT | O_RDWR, mode_t(S_IRUSR | S_IWUSR))
      guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
      guard flock(descriptor, LOCK_EX) == 0 else {
        let failure = POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        close(descriptor)
        throw failure
      }
      return descriptor
    }.value
  }

  static func release(_ descriptor: Int32) {
    close(descriptor)
  }
}
