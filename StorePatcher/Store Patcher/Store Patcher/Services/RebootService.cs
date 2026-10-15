// Reboot the phone, after the patches that need it.
//
// Only calls whose semantics are unambiguously "restart" are attempted. In
// particular NtShutdownSystem is deliberately not used: its action codes are not
// documented for this platform, and guessing wrong would power the phone off
// instead of restarting it. A reboot that cannot be triggered from an app is an
// acceptable outcome - the screen still says the reboot is required, and the user
// restarts the phone by hand.
//
// Success here means "the call was accepted", not "the phone restarted": the call
// can return before the restart happens, and the app must not claim more than it
// knows.

using System;
using System.Runtime.InteropServices;

namespace Store_Patcher.Services
{
    public sealed class RebootAttempt
    {
        /// <summary>True when a restart call was accepted by the OS.</summary>
        public bool Accepted { get; set; }

        /// <summary>Which call was accepted, or "none".</summary>
        public string Route { get; set; }

        /// <summary>Per-attempt detail, in the order they were tried.</summary>
        public string Detail { get; set; }
    }

    public static class RebootService
    {
        private const uint EwxReboot = 0x00000002;
        private const uint EwxForceIfHung = 0x00000010;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool ExitWindowsEx(uint flags, uint reason);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool InitiateSystemShutdownExW(
            string machineName,
            string message,
            uint timeoutSeconds,
            bool forceAppsClosed,
            bool rebootAfterShutdown,
            uint reason);

        public static RebootAttempt TryReboot()
        {
            RebootAttempt attempt = new RebootAttempt();
            attempt.Route = "none";
            string detail = string.Empty;

            try
            {
                if (ExitWindowsEx(EwxReboot | EwxForceIfHung, 0))
                {
                    attempt.Accepted = true;
                    attempt.Route = "ExitWindowsEx";
                    attempt.Detail = detail + "ExitWindowsEx accepted";
                    return attempt;
                }
                detail += "ExitWindowsEx refused, win32 " + Marshal.GetLastWin32Error() + "; ";
            }
            catch (Exception ex)
            {
                detail += "ExitWindowsEx unavailable (" + ex.GetType().Name + "); ";
            }

            try
            {
                if (InitiateSystemShutdownExW(null, "Store Patcher", 0, true, true, 0))
                {
                    attempt.Accepted = true;
                    attempt.Route = "InitiateSystemShutdownExW";
                    attempt.Detail = detail + "InitiateSystemShutdownExW accepted";
                    return attempt;
                }
                detail += "InitiateSystemShutdownExW refused, win32 " + Marshal.GetLastWin32Error() + "; ";
            }
            catch (Exception ex)
            {
                detail += "InitiateSystemShutdownExW unavailable (" + ex.GetType().Name + "); ";
            }

            attempt.Accepted = false;
            attempt.Detail = detail + "restart the phone by hand";
            return attempt;
        }
    }
}
