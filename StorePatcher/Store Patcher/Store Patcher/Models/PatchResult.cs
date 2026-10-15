// Per-patch outcome.
//
// A run never stops at the first failure: every patch is attempted and every
// outcome is reported, because "this one needs the fallback channel" is a result
// worth having, not an error to hide.

namespace Store_Patcher.Models
{
    public enum PatchStatus
    {
        /// <summary>Never attempted, or the outcome is unknown.</summary>
        Unknown,

        /// <summary>Written and read back identical.</summary>
        Applied,

        /// <summary>Already on the device, byte-identical: nothing was written.</summary>
        AlreadyPresent,

        /// <summary>A different value was on the device and has been replaced.</summary>
        Replaced,

        /// <summary>Attempted, did not work. See Detail and the routes that were tried.</summary>
        Failed,

        /// <summary>Deliberately not attempted, e.g. an unknown patch kind.</summary>
        Skipped
    }

    public sealed class PatchResult
    {
        public string Id { get; set; }

        public string Description { get; set; }

        public PatchStatus Status { get; set; }

        /// <summary>Which route actually did the work, e.g. "cert-store-api" or "registry".</summary>
        public string Route { get; set; }

        /// <summary>Plain-language detail: the NTSTATUS, the missing entry point, what was compared.</summary>
        public string Detail { get; set; }

        public bool RequiresReboot { get; set; }

        public static PatchResult Create(string id, string description)
        {
            return new PatchResult
            {
                Id = id,
                Description = description,
                Status = PatchStatus.Unknown,
                Route = null,
                Detail = null,
                RequiresReboot = false
            };
        }

        /// <summary>One line, as shown on the results screen.</summary>
        public string Line
        {
            get
            {
                string text = Status.ToString().ToUpperInvariant() + "  " + Id;
                if (!string.IsNullOrEmpty(Route)) text += "  [" + Route + "]";
                if (!string.IsNullOrEmpty(Detail)) text += "  " + Detail;
                return text;
            }
        }
    }
}
