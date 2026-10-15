// Does this phone actually trust the lab's certificate? Ask by using it.
//
// The check this replaces read the certificate store, which this build refuses to do
// from app code (measured), so it could only ever report the refusal. A TLS handshake
// needs no capability at all and answers the question that matters: connect to a name
// the lab hijacks and see whether the handshake completes. A completed handshake proves
// the lab's root CA is trusted for that name - whatever the status code is, including
// the 502 the lab answers on purpose for an endpoint it does not emulate yet.
//
// A failure is split into the causes the operator has to act on differently, because
// "it does not work" sends people to the wrong fix: the name does not resolve (Wi-Fi DNS
// is not pointing at the lab), the phone refused the certificate (the root CA is
// missing), or nothing answered (the lab is not running).
//
// What this cannot prove is that the handshake is a *fresh* one: a cached session would
// also succeed. It is a check made after a reboot, which is exactly the moment the cache
// is empty.

using System;
using System.Collections.Generic;
using System.Net;
using System.Text;
using System.Threading;

using Store_Patcher.Models;

namespace Store_Patcher.Services
{
    /// <summary>One name, tested. <see cref="Kind"/> is what the summary counts.</summary>
    public sealed class TrustResult
    {
        /// <summary>trusted | dns | certificate | unreachable | other</summary>
        public string Kind { get; set; }

        public string Host { get; set; }
        public bool Trusted { get; set; }
        public int StatusCode { get; set; }
        public string Detail { get; set; }

        /// <summary>The line shown in the log.</summary>
        public string Line
        {
            get
            {
                return (Trusted ? "TRUSTED  " : "REFUSED  ") + Host + "  - " + Detail;
            }
        }
    }

    public static class LabTrustProbe
    {
        /// <summary>
        /// Short on purpose: a phone on the lab's network answers at once, and waiting
        /// half a minute per name turns a check into something nobody runs.
        /// </summary>
        private const int TimeoutMilliseconds = 8000;

        /// <summary>The names worth testing: what the lab hijacks, from the patch set.</summary>
        public static List<string> Hosts(PatchSet set)
        {
            List<string> hosts = new List<string>();

            if (set != null && set.Lab != null && set.Lab.Hosts != null)
            {
                foreach (string host in set.Lab.Hosts)
                {
                    if (!string.IsNullOrEmpty(host) && !hosts.Contains(host)) hosts.Add(host);
                }
            }

            return hosts;
        }

        /// <summary>
        /// Test every name, one at a time, and report each as it finishes.
        /// </summary>
        /// <param name="onResult">Called per name, from a worker thread.</param>
        /// <param name="onDone">Called once with everything, from a worker thread.</param>
        public static void Check(List<string> hosts, Action<TrustResult> onResult, Action<List<TrustResult>> onDone)
        {
            List<TrustResult> results = new List<TrustResult>();

            if (hosts == null || hosts.Count == 0)
            {
                onDone(results);
                return;
            }

            int index = 0;
            Action next = null;

            next = delegate
            {
                if (index >= hosts.Count)
                {
                    onDone(results);
                    return;
                }

                string host = hosts[index];
                index++;

                CheckOne(host, delegate(TrustResult result)
                {
                    results.Add(result);
                    if (onResult != null) onResult(result);
                    next();
                });
            };

            next();
        }

        /// <summary>The one line that says what to do next, from what the run found.</summary>
        public static string Summarize(List<TrustResult> results, string address)
        {
            if (results == null || results.Count == 0)
            {
                return "nothing was tested: this patch set carries no host names";
            }

            int trusted = 0;
            int dns = 0;
            int certificate = 0;
            int unreachable = 0;
            string firstTrusted = null;

            foreach (TrustResult result in results)
            {
                if (result.Trusted)
                {
                    trusted++;
                    if (firstTrusted == null) firstTrusted = result.Host;
                    continue;
                }

                if (result.Kind == "dns") dns++;
                else if (result.Kind == "certificate") certificate++;
                else if (result.Kind == "unreachable") unreachable++;
            }

            if (trusted > 0)
            {
                string text = "root CA trusted: the TLS handshake to " + firstTrusted + " completed";
                if (trusted < results.Count)
                {
                    text += " (" + (results.Count - trusted) + " name(s) still failed - see the log)";
                }
                return text;
            }

            if (dns > 0)
            {
                return "no answer for " + dns + " name(s): the phone does not resolve them"
                    + (string.IsNullOrEmpty(address) ? string.Empty : " - set Wi-Fi DNS to " + address)
                    + (certificate > 0 ? ", and the certificate was refused for " + certificate + " name(s)" : string.Empty);
            }

            if (certificate > 0)
            {
                return "the phone refused the certificate for " + certificate + " name(s):"
                    + " the lab root CA is not trusted on this device";
            }

            if (unreachable > 0)
            {
                return "nothing answered for " + unreachable + " name(s): is the lab running,"
                    + " and is this phone on the same network?";
            }

            return "no name could be tested - see the log for what each attempt reported";
        }

        // ------------------------------------------------------------------ one

        private static void CheckOne(string host, Action<TrustResult> done)
        {
            TrustResult result = new TrustResult();
            result.Host = host;

            Uri uri;
            if (!Uri.TryCreate("https://" + host + "/", UriKind.Absolute, out uri))
            {
                result.Kind = "other";
                result.Detail = "\"" + host + "\" is not a usable host name";
                done(result);
                return;
            }

            HttpWebRequest request;
            try
            {
                request = (HttpWebRequest)WebRequest.Create(uri);
                request.Method = "GET";
                request.AllowAutoRedirect = false;
                request.UserAgent = "StorePatcher-trust-probe";
            }
            catch (Exception ex)
            {
                result.Kind = "other";
                result.Detail = "the request could not be built: " + ex.GetType().Name + ": " + ex.Message;
                done(result);
                return;
            }

            bool timedOut = false;
            Timer watchdog = null;

            try
            {
                // This platform's HttpWebRequest has no Timeout, so the deadline is kept
                // here: when it passes the request is aborted, and the result is a timeout
                // whatever the abort happens to raise.
                watchdog = new Timer(
                    delegate
                    {
                        timedOut = true;
                        try { request.Abort(); }
                        catch { /* it is already gone */ }
                    },
                    null,
                    TimeoutMilliseconds,
                    Timeout.Infinite);

                request.BeginGetResponse(delegate(IAsyncResult ar)
                {
                    try
                    {
                        if (timedOut)
                        {
                            result.Kind = "unreachable";
                            result.Detail = "no answer within " + (TimeoutMilliseconds / 1000) + "s: the lab is"
                                + " not running, or this phone is not on its network";
                        }
                        else
                        {
                            Read(result, request, ar);
                        }
                    }
                    finally
                    {
                        if (watchdog != null)
                        {
                            watchdog.Dispose();
                            watchdog = null;
                        }
                        done(result);
                    }
                }, null);
            }
            catch (Exception ex)
            {
                result.Kind = "other";
                result.Detail = "the request could not be started: " + ex.GetType().Name + ": " + ex.Message;
                done(result);
            }
        }

        /// <summary>Turn whatever came back into a verdict.</summary>
        private static void Read(TrustResult result, HttpWebRequest request, IAsyncResult ar)
        {
            try
            {
                using (WebResponse response = request.EndGetResponse(ar))
                {
                    Accept(result, response as HttpWebResponse);
                }
            }
            catch (WebException ex)
            {
                // An HTTP answer arriving as an exception is not a TLS failure: the lab
                // answers 502 on purpose, and this API raises for any 5xx. A response
                // object therefore means the handshake completed, which is the question.
                HttpWebResponse answered = ex.Response as HttpWebResponse;
                if (answered != null)
                {
                    try
                    {
                        Accept(result, answered);
                    }
                    finally
                    {
                        answered.Close();
                    }
                }
                else
                {
                    Describe(result, ex);
                }
            }
            catch (Exception ex)
            {
                result.Kind = "other";
                result.Detail = ex.GetType().Name + ": " + ex.Message;
            }
        }

        /// <summary>Something answered over TLS, which is the whole question.</summary>
        private static void Accept(TrustResult result, HttpWebResponse response)
        {
            result.Trusted = true;
            result.Kind = "trusted";
            result.StatusCode = response == null ? 0 : (int)response.StatusCode;

            StringBuilder detail = new StringBuilder();
            detail.Append("TLS handshake completed, HTTP ").Append(result.StatusCode);
            if (result.StatusCode == 502)
            {
                detail.Append(" (the lab's own answer for an endpoint it does not emulate yet)");
            }
            detail.Append(": this phone accepts the lab certificate for this name");

            result.Detail = detail.ToString();
        }

        /// <summary>Nothing answered over TLS. Which reason decides what to do next.</summary>
        private static void Describe(TrustResult result, WebException ex)
        {
            string inner = ex.InnerException == null
                ? string.Empty
                : " (" + ex.InnerException.GetType().Name + ": " + ex.InnerException.Message + ")";
            string seconds = (TimeoutMilliseconds / 1000).ToString();

            switch (ex.Status)
            {
                case WebExceptionStatus.NameResolutionFailure:
                    result.Kind = "dns";
                    result.Detail = "the name does not resolve: the phone's DNS is not pointing at"
                        + " the lab" + inner;
                    break;

                case WebExceptionStatus.TrustFailure:
                    result.Kind = "certificate";
                    result.Detail = "the phone refused the certificate: the lab root CA is not"
                        + " trusted here" + inner;
                    break;

                case WebExceptionStatus.SecureChannelFailure:
                    result.Kind = "certificate";
                    result.Detail = "the TLS channel was refused - the root CA may be missing, or"
                        + " the handshake failed for another reason" + inner;
                    break;

                case WebExceptionStatus.Timeout:
                    result.Kind = "unreachable";
                    result.Detail = "no answer within " + seconds + "s: the lab is not running, or"
                        + " this phone is not on its network" + inner;
                    break;

                case WebExceptionStatus.ConnectFailure:
                    result.Kind = "unreachable";
                    result.Detail = "connection refused: nothing is listening for this name on 443" + inner;
                    break;

                default:
                    result.Kind = "other";
                    result.Detail = ex.Status + ": " + ex.Message + inner;
                    break;
            }
        }
    }
}
