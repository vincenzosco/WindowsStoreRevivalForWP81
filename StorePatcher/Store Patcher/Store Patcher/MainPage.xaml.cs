// The app's only screen and its wiring.
//
// The order the buttons are in is the order that makes sense on a device: look,
// then probe, then patch, then reboot. Nothing here decides anything on its own -
// every step reports what it found, including "this does not work on this phone".

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Phone.Controls;

using Store_Patcher.Models;
using Store_Patcher.Services;

namespace Store_Patcher
{
    public partial class MainPage : PhoneApplicationPage
    {
        private readonly ObservableCollection<string> log = new ObservableCollection<string>();
        private PatchSet patchSet;
        private PatchDefinition primaryPatch;
        private List<CertificateEntry> certificates = new List<CertificateEntry>();

        public MainPage()
        {
            InitializeComponent();
            LogList.ItemsSource = log;
            Loaded += OnLoaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            LoadPatchSet();
            CheckDeviceState();

            // Answer the question that decides everything else on every launch: what
            // is this phone willing to let an app do? It is cheap and it cannot go
            // stale - the first version of this app only did it once and then kept
            // reporting a result that a manifest fix had already invalidated. The
            // report is saved, so it can be read back on the PC with no one holding
            // the phone.
            log.Add("running the capability probe; its report can be read back from the PC");
            RunProbe();
        }

        // ------------------------------------------------------------- actions

        private void OnCheckDevice(object sender, RoutedEventArgs e)
        {
            CheckDeviceState();
        }

        /// <summary>
        /// Open (or close) the certificate and lab details.
        ///
        /// The status line alone says the CA is missing, which is true but not
        /// actionable: what is missing is the thumbprint to import, the address that
        /// has to answer for the Store names, and the names themselves.
        /// </summary>
        private void OnStatusTapped(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            bool opening = DetailsPanel.Visibility != Visibility.Visible;
            DetailsPanel.Visibility = opening ? Visibility.Visible : Visibility.Collapsed;
            TapHint.Text = opening ? "tap to hide the details" : "tap for certificate and lab details";

            if (opening)
            {
                DetailsText.Text = BuildDetails();
                LoadCertificates();
            }
        }

        /// <summary>
        /// Fill the selection list with every authority this phone is being offered.
        ///
        /// Selecting one is the point of the screen: the status line says the CA is
        /// missing, and the answer to "which CA, and which DNS" is one tap away.
        /// </summary>
        private void LoadCertificates()
        {
            certificates = CertificateInventory.List(patchSet);
            CertificateList.ItemsSource = null;
            CertificateList.ItemsSource = certificates;

            if (certificates.Count > 0)
            {
                // Select the first entry without going through the event: the list is
                // rebuilt every time the panel opens, and doing it here keeps the
                // detail text and the highlighted row from ever disagreeing.
                CertificateList.SelectedIndex = 0;
                CertificateDetail.Text = certificates[0].Describe();
            }
            else
            {
                CertificateDetail.Text = "No certificate authority is offered by this build: the\n"
                    + "patch set carries none, and nothing was pushed into isolated storage.";
            }
        }

        private void OnCertificateSelected(object sender, SelectionChangedEventArgs e)
        {
            CertificateEntry entry = CertificateList.SelectedItem as CertificateEntry;
            if (entry == null) return;
            CertificateDetail.Text = entry.Describe();
        }

        private string BuildDetails()
        {
            if (primaryPatch == null)
            {
                return "No patch set is embedded in this build, so there is no certificate or lab address to show.";
            }

            LabInfo lab = patchSet == null ? null : patchSet.Lab;
            string address = lab == null || string.IsNullOrEmpty(lab.AdvertiseIp)
                ? "not set in this build"
                : lab.AdvertiseIp;

            StringBuilder text = new StringBuilder();

            text.AppendLine("LAB DNS: " + address);
            text.AppendLine("set it in Wi-Fi -> advanced -> DNS, then reconnect");
            text.AppendLine();

            text.AppendLine("ROOT CA SHA-1: " + primaryPatch.Thumbprint);
            text.AppendLine("registry: " + primaryPatch.Hive
                + "\\SOFTWARE\\Microsoft\\SystemCertificates\\" + primaryPatch.Store
                + "\\Certificates\\" + primaryPatch.Thumbprint);
            text.AppendLine();

            if (lab != null && lab.Hosts != null && lab.Hosts.Count > 0)
            {
                text.AppendLine("THE LAB ANSWERS FOR " + lab.Hosts.Count + " NAME(S):");
                foreach (string host in lab.Hosts)
                {
                    text.AppendLine("  " + host);
                }
            }
            else
            {
                text.AppendLine("The lab name list is not in this patch set.");
            }

            text.AppendLine();
            text.AppendLine("This build cannot write the registry or the certificate store: the");
            text.AppendLine("runtime refuses native calls from app code, which the capability probe");
            text.AppendLine("reports with the exact error. Import ca/install-root-ca.reg with");
            text.AppendLine("WPinternals or CMD Injector, reboot, then check this screen again.");
            text.AppendLine();
            text.AppendLine("Select an authority below to see the DNS address it belongs to and the");
            text.AppendLine("names that address is meant to answer for.");

            return text.ToString();
        }

        private void OnProbe(object sender, RoutedEventArgs e)
        {
            RunProbe();
        }

        /// <summary>Runs the probe and reports it. Shared by the button and the first launch.</summary>
        private void RunProbe()
        {
            log.Add("--- capability probe ---");

            ProbeReport report = CapabilityProbe.Run();
            foreach (ProbeLine line in report.Lines)
            {
                log.Add(line.Line);
            }
            log.Add("saved: " + report.SavedTo);
            log.Add(report.CanPatch
                ? "at least one route for installing the CA works on this phone"
                : "no route worked: fall back to ca/install-root-ca.reg (WPinternals or CMD Injector)");
        }

        private void OnApply(object sender, RoutedEventArgs e)
        {
            if (patchSet == null || patchSet.Patches.Count == 0)
            {
                log.Add("FAIL  nothing to apply: this build carries no patch set");
                return;
            }

            log.Add("--- applying " + patchSet.Patches.Count + " patch(es) ---");

            PatchRun run = PatchEngine.Apply(patchSet);
            foreach (PatchResult result in run.Results)
            {
                log.Add(result.Line);
            }
            log.Add("saved: " + run.SavedTo);

            if (run.RebootRequired)
            {
                RebootText.Visibility = Visibility.Visible;
                RebootButton.IsEnabled = true;
                log.Add("REBOOT REQUIRED  the trusted root store is read while the phone boots");
            }
            else
            {
                log.Add("no reboot needed: nothing was written, or what was needed was already in place");
            }

            CheckDeviceState();
        }

        private void OnReboot(object sender, RoutedEventArgs e)
        {
            log.Add("--- reboot attempt ---");

            RebootAttempt attempt = RebootService.TryReboot();
            log.Add((attempt.Accepted ? "ACCEPTED  " : "REFUSED  ") + attempt.Route + "  " + attempt.Detail);

            if (!attempt.Accepted)
            {
                log.Add("restart the phone by hand: hold the power button and swipe down");
            }
        }

        // -------------------------------------------------------------- state

        private void LoadPatchSet()
        {
            try
            {
                patchSet = PatchSetLoader.Load();
                primaryPatch = patchSet.Patches.Count > 0 ? patchSet.Patches[0] : null;

                StatusText.Text = string.Format(
                    "{0} patch(es), generated {1}, lab {2}",
                    patchSet.Patches.Count,
                    string.IsNullOrEmpty(patchSet.GeneratedAt) ? "unknown" : patchSet.GeneratedAt,
                    patchSet.Lab == null || string.IsNullOrEmpty(patchSet.Lab.AdvertiseIp)
                        ? "not set"
                        : patchSet.Lab.AdvertiseIp);

                ApplyButton.IsEnabled = primaryPatch != null;
            }
            catch (Exception ex)
            {
                patchSet = null;
                primaryPatch = null;
                ApplyButton.IsEnabled = false;
                StatusText.Text = "no patch set embedded in this build";
                log.Add("FAIL  " + ex.Message);
            }
        }

        private void CheckDeviceState()
        {
            if (primaryPatch == null)
            {
                StateText.Text = "root CA on device: unknown (no patch set)";
                return;
            }

            string detail;
            bool present = PatchEngine.IsAlreadyPresent(primaryPatch, out detail);
            StateText.Text = "root CA on device: " + (present ? "present" : "not present") + "  (" + detail + ")";
        }
    }
}
