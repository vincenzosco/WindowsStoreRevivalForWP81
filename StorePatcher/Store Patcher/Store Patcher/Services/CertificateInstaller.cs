// Certificate store route: the semantic way to add a trusted root.
//
// This is attempted first because it lets the OS decide how to persist the
// certificate. It is not assumed to exist: on a Windows Phone build this export
// may be missing, in which case the caller falls back to writing the verified
// registry blob itself. Neither route is trusted on its own - the caller reads the
// value back and compares it before reporting success.

using System;
using System.Runtime.InteropServices;

namespace Store_Patcher.Services
{
    public static class CertificateInstaller
    {
        // (LPCSTR)10 - CERT_STORE_PROV_SYSTEM_W, passed as the "string" pointer.
        private static readonly IntPtr StoreProviderSystemW = new IntPtr(10);

        private const uint CertSystemStoreLocalMachine = 0x00020000;

        // X509_ASN_ENCODING | PKCS_7_ASN_ENCODING
        private const uint Encoding = 0x00000001 | 0x00010000;

        // CERT_STORE_ADD_REPLACE_EXISTING
        private const uint AddReplaceExisting = 3;

        [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CertOpenStore(
            IntPtr storeProvider,
            uint encodingType,
            IntPtr cryptProvider,
            uint flags,
            string storeName);

        [DllImport("crypt32.dll", SetLastError = true)]
        private static extern bool CertAddEncodedCertificateToStore(
            IntPtr store,
            uint encodingType,
            byte[] certificate,
            uint length,
            uint disposition,
            out IntPtr context);

        [DllImport("crypt32.dll", SetLastError = true)]
        private static extern bool CertCloseStore(IntPtr store, uint flags);

        [DllImport("crypt32.dll", SetLastError = true)]
        private static extern bool CertFreeCertificateContext(IntPtr context);

        /// <summary>
        /// Check whether this build can reach the certificate store API at all.
        /// Opens and closes the store without adding anything, so it is safe to run
        /// at any time - it is what the capabilities screen reports.
        /// </summary>
        public static bool Probe(out string detail)
        {
            detail = null;
            IntPtr store = IntPtr.Zero;

            try
            {
                store = CertOpenStore(
                    StoreProviderSystemW,
                    Encoding,
                    IntPtr.Zero,
                    CertSystemStoreLocalMachine,
                    "Root");

                if (store == IntPtr.Zero)
                {
                    detail = "CertOpenStore failed, win32 " + Marshal.GetLastWin32Error();
                    return false;
                }

                detail = "machine Root store opened and closed";
                return true;
            }
            catch (Exception ex)
            {
                detail = "call unavailable - " + ex.GetType().Name + ": " + ex.Message;
                return false;
            }
            finally
            {
                if (store != IntPtr.Zero)
                {
                    try { CertCloseStore(store, 0); }
                    catch { /* nothing useful to do */ }
                }
            }
        }

        /// <summary>
        /// Try to install an encoded certificate as a trusted root in the machine store.
        /// </summary>
        /// <param name="der">The certificate, DER encoded.</param>
        /// <param name="error">Set to the reason when the route did not succeed.</param>
        /// <returns>True when the store accepted the certificate.</returns>
        public static bool TryAddToMachineRoot(byte[] der, out string error)
        {
            error = null;
            IntPtr store = IntPtr.Zero;
            IntPtr context = IntPtr.Zero;

            try
            {
                store = CertOpenStore(
                    StoreProviderSystemW,
                    Encoding,
                    IntPtr.Zero,
                    CertSystemStoreLocalMachine,
                    "Root");

                if (store == IntPtr.Zero)
                {
                    error = "CertOpenStore failed, win32 " + Marshal.GetLastWin32Error();
                    return false;
                }

                bool added = CertAddEncodedCertificateToStore(
                    store,
                    Encoding,
                    der,
                    (uint)der.Length,
                    AddReplaceExisting,
                    out context);

                if (!added)
                {
                    error = "CertAddEncodedCertificateToStore failed, win32 " + Marshal.GetLastWin32Error();
                    return false;
                }

                return true;
            }
            catch (Exception ex)
            {
                // DllNotFoundException / EntryPointNotFoundException are expected on
                // builds that do not expose crypt32: they are a result, not a crash.
                error = "call unavailable - " + ex.GetType().Name + ": " + ex.Message;
                return false;
            }
            finally
            {
                if (context != IntPtr.Zero)
                {
                    try { CertFreeCertificateContext(context); }
                    catch { /* nothing useful to do */ }
                }
                if (store != IntPtr.Zero)
                {
                    try { CertCloseStore(store, 0); }
                    catch { /* nothing useful to do */ }
                }
            }
        }
    }
}
