package com.flyer.chat.pip

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import androidx.activity.ComponentActivity
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android picture-in-picture, for video calls.
 *
 * There is no Expo API for this and no community package that does only this,
 * so it is a local module rather than a dependency. It is deliberately thin:
 * enter PiP, report whether the device allows it, and emit an event when the
 * mode changes so the JS side can strip the call chrome down to the video.
 *
 * iOS is not implemented. PiP there is a property of AVPlayerLayer and
 * AVPictureInPictureController, neither of which a WebRTC video track flows
 * through — the honest answer on iOS is that the call moves to the CallKit
 * banner instead, which the system already handles.
 */
class FlyerPipModule : Module() {
  /** Whether we have a listener attached, so we never register twice. */
  private var listenerAttached = false

  override fun definition() = ModuleDefinition {
    Name("FlyerPip")

    Events(PIP_CHANGED)

    OnCreate {
      attachListener()
    }

    /**
     * False on devices where the OEM has disabled PiP, on Android below 8.0,
     * and when the user has revoked the per-app PiP permission. Callers must
     * check this rather than assuming: `enterPictureInPictureMode` throws on a
     * device without the feature.
     */
    Function("isSupported") {
      val activity = currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }

    Function("isInPipMode") {
      val activity = currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return@Function false
      activity.isInPictureInPictureMode
    }

    /**
     * Enter PiP at the given aspect ratio, defaulting to 16:9 portrait-ish.
     *
     * Returns false rather than throwing on an unsupported device: the caller is
     * a UI button, and a rejected PiP request is not an error worth surfacing as
     * a crash. Android clamps the ratio to roughly 1:2.39–2.39:1, so extreme
     * values are corrected rather than rejected.
     */
    Function("enterPipMode") { width: Int?, height: Int? ->
      val activity = currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
        return@Function false
      }

      // OnCreate can run before the activity is attached, so this is the
      // reliable point to bind the listener: by now one certainly exists.
      attachListener()

      val w = width?.takeIf { it > 0 } ?: 9
      val h = height?.takeIf { it > 0 } ?: 16

      runCatching {
        val params = PictureInPictureParams.Builder()
          .setAspectRatio(Rational(w, h))
          .build()
        activity.enterPictureInPictureMode(params)
      }.getOrDefault(false)
    }
  }

  private val currentActivity: Activity?
    get() = appContext.activityProvider?.currentActivity

  /**
   * PiP transitions are not part of the normal activity lifecycle, so the only
   * way to observe them is the dedicated listener on ComponentActivity. Wrapped
   * in runCatching because the host activity is not ours: if it is ever not a
   * ComponentActivity, PiP still works, we just stop reporting the transition —
   * and the JS side falls back to watching the window dimensions.
   */
  private fun attachListener() {
    if (listenerAttached) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val activity = currentActivity as? ComponentActivity ?: return

    runCatching {
      activity.addOnPictureInPictureModeChangedListener { info ->
        sendEvent(PIP_CHANGED, mapOf("isInPipMode" to info.isInPictureInPictureMode))
      }
      listenerAttached = true
    }
  }

  companion object {
    private const val PIP_CHANGED = "onPipModeChanged"
  }
}
