// Outcome of a native call.
//
// A missing DLL or entry point is not a crash here: on a Windows Phone build the
// export may simply not exist, and that is a finding the operator needs on screen.
// Every native wrapper therefore reports either an NTSTATUS or the reason the call
// could not be made at all.

using System;

namespace Store_Patcher.Interop
{
    public sealed class NativeResult
    {
        /// <summary>True when the call returned STATUS_SUCCESS (0).</summary>
        public bool Ok { get; set; }

        /// <summary>Returned NTSTATUS. Meaningless when <see cref="Error"/> is set.</summary>
        public int Status { get; set; }

        /// <summary>Set when the call could not be made at all: missing DLL, missing export, marshal failure.</summary>
        public string Error { get; set; }

        /// <summary>Registry value type, when the call read one.</summary>
        public uint Type { get; set; }

        public static NativeResult Success()
        {
            return new NativeResult { Ok = true, Status = 0 };
        }

        public static NativeResult FromStatus(int status)
        {
            return new NativeResult { Ok = status == 0, Status = status };
        }

        public static NativeResult Unavailable(Exception ex)
        {
            return new NativeResult
            {
                Ok = false,
                Status = unchecked((int)0xE0000000),
                Error = ex.GetType().Name + ": " + ex.Message
            };
        }

        /// <summary>Human-readable one-liner for the results screen.</summary>
        public string Describe()
        {
            if (Error != null) return "call unavailable - " + Error;
            if (Ok) return "ok";
            return "status 0x" + Status.ToString("X8") + Name(Status);
        }

        private static string Name(int status)
        {
            switch (unchecked((uint)status))
            {
                case 0xC0000034: return " (object name not found)";
                case 0xC000003A: return " (path not found)";
                case 0xC0000022: return " (access denied)";
                case 0xC0000023: return " (buffer too small)";
                case 0xC000000D: return " (invalid parameter)";
                case 0xC0000061: return " (privilege not held)";
                default: return string.Empty;
            }
        }
    }
}
