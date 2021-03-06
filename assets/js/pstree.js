/*
 * Copyright (C) 2014 Opersys inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var procView, logCatView,
    // Options
    options = new Options(),
    // ProcessCollection object, collection of all process.
    ps = new ProcessCollection(),
    // Global CPU Info
    globalCpu = new CpuInfo(),
    // Individual CPU info
    cpuInfo = new CpuInfoCollection(),
    // Logcat
    logCatLines = new LogCatLines(),
    // Memory info
    memInfo = new MemInfo(),
    // Concept
    logcat = new LogCat(),
    // CPU % chart
    cpuChart,
    // Mem % chart
    memChart;

var resizeWindow = function () {
    $("#mainLayout")
        .width($(window).width())
        .height($(window).height());
    w2ui["mainLayout"].resize();
};

function uncompress(clist) {
    var ctab = clist.ctab;
    var lstlst = clist.list;
    var r = [];

    _.each(lstlst, function (lst) {
        var obj = {};

        _.each(ctab, function (k) {
            obj[k] = lst.shift();
        });
        r.push(obj);
    });
    return r;
}

function showApropos() {
    w2popup.load({
        width: "640",
        height: "480",
        url: "/apropos"
    });
}

var graphUpdate = function () {
    $.ajax("/cpuinfo").done(function (cpuinfo) {
        cpuInfo.set(cpuinfo.cpus);

        // Initialize and update the CPU graph
        cpuInfo.each(function (ci) {
            if (!cpuChart.hasSerie(ci.get("no")))
                cpuChart.serie(ci.get("no"), "userPct", ci);

            cpuChart.addSerieData(ci.get("no"), ci.get("userPct"));
        });
    });

    $.ajax("/meminfo").done(function (meminfo) {
        memInfo.set(meminfo);

        if (!memChart.hasSerie("memUsed"))
            memChart.serie("memUsed");

        // Update the memory chart range if needed.
        if (memChart.getRange().max != memInfo.get("memTotal"))
            memChart.setRange({min: 0, max: memInfo.get("memTotal")});

        // Update the memory graphs.
        memChart.addSerieData("memUsed", memInfo.get("memUsed"));
    });
};

var globalProcessUpdate = function () {
    $.ajax("/sysinfo").done(function (sysinfo) {
        var totalDeltaTime;

        globalCpu.set(sysinfo.cpuinfo.global);
        cpuInfo.set(sysinfo.cpuinfo.cpus);
        memInfo.set(sysinfo.meminfo);

        ps.set(uncompress(sysinfo.ps));

        ps.each(function (proc) {
            var newChildren = {};

            proc.updateCpuPct(globalCpu.get("totalDeltaTime") / globalCpu.get("ncpu"));
            proc.updateMemPct(memInfo.get("memTotal"));

            _.each(_.keys(proc.get("ui-children")), function (cprocPid) {
                if (!ps.get(cprocPid)) {
                    proc.get("ui-children")[cprocPid].set("ui-dead", true);
                    newChildren[cprocPid] = proc.get("ui-children")[cprocPid];
                } else
                    newChildren[cprocPid] = ps.get(cprocPid);
            });
            proc.set("ui-children", newChildren);
        });

        // Calculate the process tree
        ps.each(function (e) {
            if (e.get("pid") != 0 && e.get("ppid") != undefined) {
                var ppsItem = ps.get(e.get("ppid"));
                var ppsItemCh = ppsItem.get("ui-children");

                // Add the new children to the parent.
                ppsItemCh[e.get("pid")] = e;
                ppsItem.set({"ui-children": ppsItemCh});

                // Set the indent and the order of the current process in the
                // tree view.
                e.set({
                    "ui-indent": ppsItem.get("ui-indent") +  1,
                    "ui-parent": ppsItem
                });
            }
        });
    });
};

function setButton(toolbar, btnId, value) {
    _.each(toolbar.items, function (b) {
        if (b.id == btnId) {
            _.each(_.keys(value), function (k) {
                b[k] = value[k];
            });
        }
    });
}

$(document).ready(function () {
    var updateTimer, graphUpdateTimer;

    options.fetch();
    options.initOption("pidFilterMode", false);
    options.initOption("rowColorMode", false);
    options.initOption("paused", false);
    options.initOption("delay", 5000);
    options.initOption("graphDelay", 2000);
    options.initOption("maximizeLogcat", false);
    options.initOption("minimizeLogcat", false);
    options.initOption("filterError", true);
    options.initOption("filterWarning", true);
    options.initOption("filterInfo", true);
    options.initOption("filterDebug", true);
    options.initOption("filterVerbose", true);

    // Initialize the timer.
    updateTimer = $.timer(globalProcessUpdate, options.getOptionValue("delay"));
    graphUpdateTimer = $.timer(graphUpdate, options.getOptionValue("graphDelay"));

    var toggleTagFilter = function (optName, tagVal) {
        return function () {
            var v = options.getOptionValue(optName);

            if (v)
                logCatView.addTagFilter(tagVal);
            else
                logCatView.clearTagFilter(tagVal);
        };
    };

    options.getOption("filterError").on("change", toggleTagFilter("filterError", "E"));
    options.getOption("filterWarning").on("change", toggleTagFilter("filterWarning", "W"));
    options.getOption("filterInfo").on("change", toggleTagFilter("filterInfo", "I"));
    options.getOption("filterDebug").on("change", toggleTagFilter("filterDebug", "D"));
    options.getOption("filterVerbose").on("change", toggleTagFilter("filterVerbose", "V"));

    options.getOption("paused").on("change", function () {
        var v = options.getOptionValue("paused");

        if (!v) {
            updateTimer.play();
            graphUpdateTimer.play();

            if (cpuChart) cpuChart.start();
            if (memChart) memChart.start();
        }
        else {
            updateTimer.pause();
            graphUpdateTimer.pause();

            if (cpuChart) cpuChart.stop();
            if (memChart) memChart.stop();
        }
    });

    options.getOption("delay").on("change", function () {
        var v = options.getOptionValue("delay");

        updateTimer.set({ time: v });

        // Update the toolbar text.
        setButton(w2ui["mainLayout"].get("main").toolbar, "mnuDelay", {
            caption: (v / 1000) + "s"
        });

        w2ui["mainLayout"].get("main").toolbar.refresh("mnuDelay");
    });

    options.getOption("graphDelay").on("change", function () {
        var v = options.getOptionValue("graphDelay");

        graphUpdateTimer.set({ time: v });

        cpuChart.resetDelay(v);
        memChart.resetDelay(v);

        // Update the toolbar text.
        setButton(w2ui["mainLayout"].get("main").toolbar, "mnuGraphDelay", {
            caption: (v / 1000) + "s"
        });

        w2ui["mainLayout"].get("main").toolbar.refresh("mnuGraphDelay");
    });

    options.getOption("minimizeLogcat").on("change", function () {
        var buttonsToHide = [
            "btnFilterByProcess", "btnClear", "btnColors", "btnEnd",
            "btnFilterError", "btnFilterWarning", "btnFilterInfo", "btnFilterDebug",
            "btnFilterVerbose"
        ];

        var panel = w2ui["mainLayout"].get("preview");

        if (options.getOptionValue("minimizeLogcat")) {
            _.each(buttonsToHide, function (btn) {
                setButton(panel.toolbar, btn, {hidden: true});
            });
            setButton(panel.toolbar, "btnMinimize", {icon: "icon-chevron-up"});

            w2ui["mainLayout"].set("preview", {size: 0});
        } else {
            _.each(buttonsToHide, function (btn) {
                setButton(panel.toolbar, btn, {hidden: false});
            });
            setButton(panel.toolbar, "btnMinimize", {icon: "icon-chevron-down"});

            w2ui["mainLayout"].set("preview", {size: 200});
        }

        panel.toolbar.refresh();
        logCatView.setElement(w2ui["mainLayout"].el("preview"));
        logCatView.render();
    });

    $("#mainLayout").w2layout({
        name: "mainLayout",
        padding: 4,
        panels: [
            {
                type: "main",
                toolbar: {
                    items: [
                        { type: "check", id: "btnPause", icon: "icon-pause",
                            checked: options.getOptionValue("paused")
                        },
                        { type: "break" },
                        { type: "html", html: "<span style='margin-left: 1em'>Process delay:</span>" },
                        { type: "menu",  id: "mnuDelay", caption: "", img: "icon-time", items: [
                            { id: "1000", text: "1 sec" },
                            { id: "2000", text: "2 sec" },
                            { id: "5000", text: "5 sec" },
                            { id: "10000", text: "10 sec" }
                        ]},
                        { type: "break" },
                        { type: "html", html: "<span style='margin-left: 1em'>Graph delay:</span>" },
                        { type: "menu",  id: "mnuGraphDelay", caption: "", img: "icon-time", items: [
                            { id: "500", text: "500 msec"},
                            { id: "1000", text: "1 sec" },
                            { id: "2000", text: "2 sec" },
                            { id: "5000", text: "5 sec" },
                            { id: "10000", text: "10 sec" }
                        ]},
                        { type: "break" },
                        { type: "html", html: "<span id='txtSortType' style='margin-left: 1em'>No sorting</span>" },
                        { type: "button", id: "btnCancelSort", caption: "Cancel", disabled: true },
                        { type: "spacer" },
                        { type: "html", html: "<div id='cpuGraph'></div>" },
                        { type: "html", html: "<div id='memGraph'></div>" },
                        { type: "html", html:
                            "<a href='http://www.opersys.com'><img alt='opersys logo' src='/images/opersys_land_logo.png' /></a>" },
                        { type: "html", html:
                            "<a href='javascript:showApropos()'><img alt='copyright icon' src='/images/copyright.png' /></a>" }
                    ],
                    onClick: function (ev) {
                        if (ev.target == "btnPause")
                            options.toggleOption("paused");

                        if (ev.target == "btnCancelSort") {
                            procView.treeSort();
                            $("#txtSortType").text("No sorting");
                            w2ui["mainLayout"].get("main").toolbar.disable("btnCancelSort");
                        }

                        if (ev.target == "mnuDelay" && ev.subItem)
                            options.setOptionValue("delay", ev.subItem.id);

                        if (ev.target == "mnuGraphDelay" && ev.subItem)
                            options.setOptionValue("graphDelay", ev.subItem.id);
                    }
                }
            },
            {
                type: "preview",
                size: 200,
                resizer: 5,
                resizable: true,
                toolbar: {
                    name: "tbPreview",
                    items: [
                        { type: "check",  id: "btnFilterByProcess", caption: "Filter", icon: "icon-long-arrow-down",
                          checked: options.getOptionValue("pidFilterMode")
                        },
                        { type: "button", id: "btnClear", caption: "Clear",  icon: "icon-remove" },
                        { type: "check",  id: "btnColors", caption: "Color",  icon: "icon-tint",
                          checked: options.getOptionValue("rowColorMode")
                        },
                        { type: "button", id: "btnEnd", caption: "", icon: "icon-double-angle-down" },
                        { type: "break" },
                        { type: "check", id: "btnFilterError", caption: "E",
                          checked: options.getOptionValue("filterError") },
                        { type: "check", id: "btnFilterWarning", caption: "W",
                          checked: options.getOptionValue("filterWarning") },
                        { type: "check", id: "btnFilterInfo", caption: "I",
                          checked: options.getOptionValue("filterInfo") },
                        { type: "check", id: "btnFilterDebug", caption: "D",
                          checked: options.getOptionValue("filterDebug") },
                        { type: "check", id: "btnFilterVerbose", caption: "V",
                          checked: options.getOptionValue("filterVerbose") },
                        { type: "break" },
                        { type: "html",   id: "txtFiltered", html: "<div id='txtFiltered'></div>" },
                        { type: "spacer" },
                        { type: "button", id: "btnMinimize", icon: "icon-chevron-down" }
                    ],
                    onClick: function (ev) {
                        if (ev.target == "btnClear")
                            logCatLines.clearAll();

                        if (ev.target == "btnFilterByProcess")
                            options.toggleOption("pidFilterMode");

                        if (ev.target == "btnColors")
                            options.toggleOption("rowColorMode");

                        if (ev.target == "btnMinimize")
                            options.toggleOption("minimizeLogcat");

                        if (ev.target == "btnEnd")
                            logCatView.scrollToEnd();

                        if (ev.target == "btnFilterError")
                            options.toggleOption("filterError");

                        if (ev.target == "btnFilterWarning")
                            options.toggleOption("filterWarning");

                        if (ev.target == "btnFilterInfo")
                            options.toggleOption("filterInfo");

                        if (ev.target == "btnFilterDebug")
                            options.toggleOption("filterDebug");

                        if (ev.target == "btnFilterVerbose")
                            options.toggleOption("filterVerbose");
                    }
                }
            }
        ],
        onResize: function (ev) {
            // Thanks, w2ui. This thing is elegant but rather confusing...
            ev.onComplete = function () {
                if (procView)
                    procView.autoResize();
                if (logCatView)
                    logCatView.autoResize();
            };
        }
    });

    cpuChart = new ChartView({
        el: $("#cpuGraph"),
        max: 100,
        min: 0,
        delay: options.getOptionValue("graphDelay"),
        width: 200,
        height: 50
    });
    memChart = new ChartView({
        el: $("#memGraph"),
        min: 0,
        delay: options.getOptionValue("graphDelay"),
        width: 200,
        height:50
    });
    procView = new ProcessView({
        el: $(w2ui["mainLayout"].el("main")).addClass("processview"),
        ps: ps,
        options: options
    });
    logCatView = new LogCatView({
        el: $(w2ui["mainLayout"].el("preview")).addClass("logcatview"),
        logcat: logCatLines,
        options: options
    });

    ps.on("remove", function (proc) {
        console.log("Process " + proc.get("name") + "[" + proc.get("pid") + "] removed.");
    });

    procView.on("sort", function (sortField, sortFieldText) {
        $("#txtSortType").text("Sorting by: " + sortFieldText);
        w2ui["mainLayout"].get("main").toolbar.enable("btnCancelSort");
    });

    procView.on("onProcessSelected", function (el) {
        if (options.getOptionValue("pidFilterMode"))
            logCatView.filterByPid(el.get("pid"));
    });

    // Add the options handlers.
    options.getOption("pidFilterMode").on("change", function () {
        if (!options.getOptionValue("pidFilterMode"))
            logCatView.clearPidFilter();
        else {
            if (procView.getSelectedProcess())
                logCatView.filterByPid(procView.getSelectedProcess().get("pid"));
        }
    });

    $(window).resize($.debounce(100, resizeWindow));

    options.activate();

    // Update the process list right now.
    globalProcessUpdate();

    // Reformat the window content.
    resizeWindow();
});