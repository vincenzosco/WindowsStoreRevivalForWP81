// The app's only screen and its wiring.
//
// The order the buttons are in is the order that makes sense on a device: look,
// then probe, then patch, then reboot. Nothing here decides anything on its own -
// every step reports what it found, including "this does not work on this phone".

using System;
using System.Collections.ObjectModel;
using System.Windows;
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
