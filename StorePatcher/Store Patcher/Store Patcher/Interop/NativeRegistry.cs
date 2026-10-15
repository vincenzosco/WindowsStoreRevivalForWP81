// Registry access through the NT native API.
//
// Why not Microsoft.Win32.Registry: it does not exist on Windows Phone, and the
// managed store APIs that do exist cannot write the certificate stores. The native
// calls are what an interop-unlocked app can reach, and they are also the only way
// to write the *exact* REG_BINARY bytes the desktop side verified.
//
// Everything is best-effort and reported: a build that does not expose these
// exports returns "call unavailable", it does not throw.

using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Store_Patcher.Interop
{
    public static class NativeRegistry
    {
        // ACCESS_MASK
        private const uint KeyRead = 0x20019;
        private const uint KeyReadWrite = 0x2001F;

        // REG_* value types
        public const uint RegSz = 1;
        public const uint RegBinary = 3;

        // KEY_VALUE_INFORMATION_CLASS
        private const uint KeyValuePartialInformation = 2;

        private const int StatusBufferTooSmall = unchecked((int)0xC0000023);

        private const string MachinePrefix = "\\Registry\\Machine\\";
        private const string UserPrefix = "\\Registry\\User\\";
        private const string ClassesPrefix = "\\Registry\\Machine\\SOFTWARE\\Classes\\";

        [StructLayout(LayoutKind.Sequential)]
        private struct UnicodeString
        {
            public ushort Length;
            public ushort MaximumLength;
            public IntPtr Buffer;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ObjectAttributes
        {
            public int Length;
            public IntPtr RootDirectory;
            public IntPtr ObjectName;
            public uint Attributes;
            public IntPtr SecurityDescriptor;
            public IntPtr SecurityQualityOfService;
        }

        [DllImport("ntdll.dll")]
        private static extern int NtOpenKey(out IntPtr keyHandle, uint desiredAccess, ref ObjectAttributes objectAttributes);

        [DllImport("ntdll.dll")]
        private static extern int NtCreateKey(
            out IntPtr keyHandle,
            uint desiredAccess,
            ref ObjectAttributes objectAttributes,
            uint titleIndex,
            IntPtr className,
            uint createOptions,
            out uint disposition);

        [DllImport("ntdll.dll")]
        private static extern int NtSetValueKey(
            IntPtr keyHandle,
            ref UnicodeString valueName,
            uint titleIndex,
            uint type,
            byte[] data,
            uint dataSize);

        [DllImport("ntdll.dll")]
        private static extern int NtQueryValueKey(
            IntPtr keyHandle,
            ref UnicodeString valueName,
            uint keyValueInformationClass,
            byte[] keyValueInformation,
            uint length,
            out uint resultLength);

        [DllImport("ntdll.dll")]
        private static extern int NtDeleteValueKey(IntPtr keyHandle, ref UnicodeString valueName);

        [DllImport("ntdll.dll")]
        private static extern int NtClose(IntPtr handle);

        /// <summary>Translate a hive name into its NT object path prefix.</summary>
        public static string NtPath(string hive, string subKey)
        {
            string prefix;
            if (string.Equals(hive, "HKLM", StringComparison.OrdinalIgnoreCase)
                || string.Equals(hive, "HKEY_LOCAL_MACHINE", StringComparison.OrdinalIgnoreCase))
            {
                prefix = MachinePrefix;
            }
            else if (string.Equals(hive, "HKCR", StringComparison.OrdinalIgnoreCase)
                || string.Equals(hive, "HKEY_CLASSES_ROOT", StringComparison.OrdinalIgnoreCase))
            {
                prefix = ClassesPrefix;
            }
            else if (string.Equals(hive, "HKU", StringComparison.OrdinalIgnoreCase)
                || string.Equals(hive, "HKEY_USERS", StringComparison.OrdinalIgnoreCase))
            {
                prefix = UserPrefix;
            }
            else
            {
                throw new NotSupportedException("unsupported hive: " + hive);
            }

            return prefix + subKey.TrimStart('\\');
        }

        // ------------------------------------------------------------- key access

        public static NativeResult OpenKey(string hive, string subKey, bool forWriting, out IntPtr handle)
        {
            handle = IntPtr.Zero;
            IntPtr nameStruct = IntPtr.Zero;
            IntPtr nameBuffer = IntPtr.Zero;

            try
            {
                nameStruct = AllocateUnicodeString(NtPath(hive, subKey), out nameBuffer);

                ObjectAttributes attributes = new ObjectAttributes();
                attributes.Length = Marshal.SizeOf(typeof(ObjectAttributes));
                attributes.ObjectName = nameStruct;

                return NativeResult.FromStatus(
                    NtOpenKey(out handle, forWriting ? KeyReadWrite : KeyRead, ref attributes));
            }
            catch (Exception ex)
            {
                return NativeResult.Unavailable(ex);
            }
            finally
            {
                Free(nameStruct, nameBuffer);
            }
        }

        /// <summary>Open the key, creating it when it does not exist yet.</summary>
        public static NativeResult EnsureKey(string hive, string subKey, out IntPtr handle)
        {
            NativeResult opened = OpenKey(hive, subKey, true, out handle);
            if (opened.Ok) return opened;
            if (opened.Error != null) return opened;

            handle = IntPtr.Zero;
            IntPtr nameStruct = IntPtr.Zero;
            IntPtr nameBuffer = IntPtr.Zero;

            try
            {
                nameStruct = AllocateUnicodeString(NtPath(hive, subKey), out nameBuffer);

                ObjectAttributes attributes = new ObjectAttributes();
                attributes.Length = Marshal.SizeOf(typeof(ObjectAttributes));
                attributes.ObjectName = nameStruct;

                uint disposition;
                int status = NtCreateKey(out handle, KeyReadWrite, ref attributes, 0, IntPtr.Zero, 0, out disposition);
                if (status != 0)
                {
                    // Report the create attempt, but keep the open failure visible:
                    // "path missing" and "no privilege" need different fallbacks.
                    return new NativeResult
                    {
                        Ok = false,
                        Status = status,
                        Error = null
                    };
                }
                return NativeResult.Success();
            }
            catch (Exception ex)
            {
                return NativeResult.Unavailable(ex);
            }
            finally
            {
                Free(nameStruct, nameBuffer);
            }
        }

        public static void Close(IntPtr handle)
        {
            if (handle == IntPtr.Zero) return;
            try { NtClose(handle); }
            catch { /* nothing useful to do */ }
        }

        // ------------------------------------------------------------ values

        public static NativeResult SetBinary(IntPtr keyHandle, string valueName, byte[] data)
        {
            return SetValue(keyHandle, valueName, RegBinary, data);
        }

        public static NativeResult SetString(IntPtr keyHandle, string valueName, string text)
        {
            byte[] bytes = Encoding.Unicode.GetBytes(text + "\0");
            return SetValue(keyHandle, valueName, RegSz, bytes);
        }

        public static NativeResult SetValue(IntPtr keyHandle, string valueName, uint type, byte[] data)
        {
            IntPtr nameStruct = IntPtr.Zero;
            IntPtr nameBuffer = IntPtr.Zero;

            try
            {
                nameStruct = AllocateUnicodeString(valueName, out nameBuffer);
                UnicodeString name = (UnicodeString)Marshal.PtrToStructure(nameStruct, typeof(UnicodeString));

                return NativeResult.FromStatus(
                    NtSetValueKey(keyHandle, ref name, 0, type, data, (uint)data.Length));
            }
            catch (Exception ex)
            {
                return NativeResult.Unavailable(ex);
            }
            finally
            {
                Free(nameStruct, nameBuffer);
            }
        }

        public static NativeResult DeleteValue(IntPtr keyHandle, string valueName)
        {
            IntPtr nameStruct = IntPtr.Zero;
            IntPtr nameBuffer = IntPtr.Zero;

            try
            {
                nameStruct = AllocateUnicodeString(valueName, out nameBuffer);
                UnicodeString name = (UnicodeString)Marshal.PtrToStructure(nameStruct, typeof(UnicodeString));

                return NativeResult.FromStatus(NtDeleteValueKey(keyHandle, ref name));
            }
            catch (Exception ex)
            {
                return NativeResult.Unavailable(ex);
            }
            finally
            {
                Free(nameStruct, nameBuffer);
            }
        }

        /// <summary>Read a value of any type. Returns the raw bytes and the registry type.</summary>
        public static NativeResult ReadValue(IntPtr keyHandle, string valueName, out byte[] data)
        {
            data = null;
            IntPtr nameStruct = IntPtr.Zero;
            IntPtr nameBuffer = IntPtr.Zero;

            try
            {
                nameStruct = AllocateUnicodeString(valueName, out nameBuffer);
                UnicodeString name = (UnicodeString)Marshal.PtrToStructure(nameStruct, typeof(UnicodeString));

                int capacity = 4096;
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    byte[] buffer = new byte[capacity];
                    uint resultLength;
                    int status = NtQueryValueKey(
                        keyHandle, ref name, KeyValuePartialInformation, buffer, (uint)buffer.Length, out resultLength);

                    if (status == StatusBufferTooSmall)
                    {
                        // resultLength is the size needed; retry once with it.
                        capacity = (int)resultLength + 16;
                        continue;
                    }

                    if (status != 0) return NativeResult.FromStatus(status);

                    // KEY_VALUE_PARTIAL_INFORMATION:
                    //   ULONG TitleIndex; ULONG Type; ULONG DataLength; UCHAR Data[];
                    uint type = BitConverter.ToUInt32(buffer, 4);
                    uint length = BitConverter.ToUInt32(buffer, 8);

                    byte[] value = new byte[length];
                    if (length > 0) Array.Copy(buffer, 12, value, 0, (int)length);
                    data = value;

                    NativeResult ok = NativeResult.Success();
                    ok.Type = type;
                    return ok;
                }

                return new NativeResult { Ok = false, Status = StatusBufferTooSmall, Error = "value larger than the read buffer" };
            }
            catch (Exception ex)
            {
                return NativeResult.Unavailable(ex);
            }
            finally
            {
                Free(nameStruct, nameBuffer);
            }
        }

        /// <summary>Read a REG_SZ value as text.</summary>
        public static NativeResult ReadString(string hive, string subKey, string valueName, out string text)
        {
            text = null;
            IntPtr handle = IntPtr.Zero;

            try
            {
                NativeResult opened = OpenKey(hive, subKey, false, out handle);
                if (!opened.Ok) return opened;

                byte[] data;
                NativeResult read = ReadValue(handle, valueName, out data);
                if (!read.Ok) return read;

                text = data == null ? string.Empty : Encoding.Unicode.GetString(data, 0, data.Length).TrimEnd('\0');
                return read;
            }
            finally
            {
                Close(handle);
            }
        }

        // ------------------------------------------------------------ plumbing

        /// <summary>
        /// Build a UNICODE_STRING in unmanaged memory: the buffer, then the struct
        /// that points at it. Both handles are returned so the caller can free them.
        /// </summary>
        private static IntPtr AllocateUnicodeString(string value, out IntPtr bufferHandle)
        {
            byte[] bytes = Encoding.Unicode.GetBytes(value);

            bufferHandle = Marshal.AllocHGlobal(bytes.Length + 2);
            Marshal.Copy(bytes, 0, bufferHandle, bytes.Length);
            Marshal.WriteInt16(bufferHandle, bytes.Length, 0);

            UnicodeString text = new UnicodeString();
            text.Length = (ushort)bytes.Length;
            text.MaximumLength = (ushort)(bytes.Length + 2);
            text.Buffer = bufferHandle;

            IntPtr structureHandle = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeString)));
            Marshal.StructureToPtr(text, structureHandle, false);
            return structureHandle;
        }

        private static void Free(IntPtr structureHandle, IntPtr bufferHandle)
        {
            if (structureHandle != IntPtr.Zero) Marshal.FreeHGlobal(structureHandle);
            if (bufferHandle != IntPtr.Zero) Marshal.FreeHGlobal(bufferHandle);
        }
    }
}
