import React, { useState, useEffect, useCallback } from 'react';
import yaml from 'js-yaml';
import DeleteRepo from './DeleteRepo';

function UpdateRepo({ repo, onCancel, onRepoUpdated, onRepoDeleted }) {
    const [activeTab, setActiveTab] = useState('config'); // 'config' or 'instructions'
    const [viewMode, setViewMode] = useState('simple'); // 'simple' or 'yaml'
    
    const [yamlContent, setYamlContent] = useState('');
    const [originalYamlContent, setOriginalYamlContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Form State for Simple View
    const [reviewConfig, setReviewConfig] = useState({
        pullRequests: '',
        excludePullRequests: '',
        labels: '', // multiline string
    });
    
    const [devConfig, setDevConfig] = useState({
        branches: '',
        excludeBranches: '',
    });

    const [issueHandlers, setIssueHandlers] = useState([]);

    // Instructions state
    const [currentInstructions, setCurrentInstructions] = useState('');
    const [draftInstructions, setDraftInstructions] = useState('');
    const [originalDraftInstructions, setOriginalDraftInstructions] = useState('');
    const [hasDraft, setHasDraft] = useState(false);
    const [instructionsError, setInstructionsError] = useState('');
    const [isInstructionsLoading, setIsInstructionsLoading] = useState(false);

    // Helpers
    const parseList = (str) => str ? str.split(',').map(s => s.trim()).filter(s => s) : [];
    const formatList = (arr) => arr ? arr.join(', ') : '';
    const formatLabelGroups = (groups) => {
        if (!groups) return '';
        return groups.map(g => g.join(', ')).join('\n');
    };
    const parseLabelGroups = (str) => {
        return str.split('\n').map(line => line.split(',').map(s => s.trim()).filter(s => s)).filter(g => g.length > 0);
    };

    const parseYamlToState = useCallback((yamlStr) => {
        try {
            const doc = yaml.load(yamlStr);
            if (!doc || !doc.spec) return;

            // Review
            const r = doc.spec.review || {};
            setReviewConfig({
                pullRequests: formatList(r.pullRequests),
                excludePullRequests: formatList(r.excludePullRequests),
                labels: formatLabelGroups(r.labels)
            });

            // Dev
            const d = doc.spec.dev || {};
            setDevConfig({
                branches: formatList(d.branches),
                excludeBranches: formatList(d.excludeBranches)
            });

            // Issue Handlers
            const handlers = (doc.spec.issueHandlers || []).map((h, idx) => ({
                id: idx,
                name: h.name,
                labels: formatList(h.labels), // Issue labels are []string
                issues: formatList(h.issues),
                excludeIssues: formatList(h.excludeIssues)
            }));
            setIssueHandlers(handlers);

        } catch (e) {
            console.error("Failed to parse YAML for form", e);
            // Don't switch view mode here to avoid loops, just log
        }
    }, []);

    const updateYamlFromState = () => {
         try {
            const doc = yaml.load(yamlContent) || {};
            if (!doc.spec) doc.spec = {};

            // Review
            if (!doc.spec.review) doc.spec.review = { maxActiveSandboxes: 1 };
            
            const prs = parseList(reviewConfig.pullRequests).map(Number).filter(n => !isNaN(n));
            if (prs.length > 0) doc.spec.review.pullRequests = prs;
            else delete doc.spec.review.pullRequests;

            const exprs = parseList(reviewConfig.excludePullRequests).map(Number).filter(n => !isNaN(n));
            if (exprs.length > 0) doc.spec.review.excludePullRequests = exprs;
            else delete doc.spec.review.excludePullRequests;
            
            const labels = parseLabelGroups(reviewConfig.labels);
            if (labels.length > 0) doc.spec.review.labels = labels;
            else delete doc.spec.review.labels;

            // Dev
            if (!doc.spec.dev) doc.spec.dev = { maxSandboxes: 2, maxActiveSandboxes: 1 };
            
            const branches = parseList(devConfig.branches);
            if (branches.length > 0) doc.spec.dev.branches = branches;
            else delete doc.spec.dev.branches;

            const exbranches = parseList(devConfig.excludeBranches);
            if (exbranches.length > 0) doc.spec.dev.excludeBranches = exbranches;
            else delete doc.spec.dev.excludeBranches;

            // Issue Handlers
            // We construct based on existing doc.spec.issueHandlers structure to preserve other fields
            const existingHandlers = doc.spec.issueHandlers || [];
            
            const newHandlers = issueHandlers.map((h, idx) => {
                 // Try to match by index if possible, otherwise by name?
                 // Simple view assumes order hasn't changed drastically or uses state ID.
                 const existing = existingHandlers[h.id] || {};
                 
                 const newH = {
                     ...existing,
                     name: h.name,
                 };

                 const lbls = parseList(h.labels);
                 if (lbls.length > 0) newH.labels = lbls;
                 else delete newH.labels;

                 const issues = parseList(h.issues).map(Number).filter(n => !isNaN(n));
                 if (issues.length > 0) newH.issues = issues;
                 else delete newH.issues;

                 const exIssues = parseList(h.excludeIssues).map(Number).filter(n => !isNaN(n));
                 if (exIssues.length > 0) newH.excludeIssues = exIssues;
                 else delete newH.excludeIssues;

                 return newH;
            });
            
            if (newHandlers.length > 0) doc.spec.issueHandlers = newHandlers;
            // Note: if user deleted a handler in simple view (not implemented yet), we would need to handle that.

            return yaml.dump(doc);
         } catch (e) {
             console.error("Failed to update YAML from state", e);
             return yamlContent;
         }
    };

    useEffect(() => {
        setIsLoading(true);
        fetch(`/api/repos/${repo.name}/yaml`)
            .then(res => {
                if (!res.ok) throw new Error("Failed to fetch repo YAML");
                return res.json();
            })
            .then(data => {
                if (data.yaml) {
                    setYamlContent(data.yaml);
                    setOriginalYamlContent(data.yaml);
                    parseYamlToState(data.yaml);
                }
                setIsLoading(false);
            })
            .catch(err => {
                console.error(err);
                setError(err.message);
                setIsLoading(false);
            });
    }, [repo.name, parseYamlToState]);

    const fetchInstructions = useCallback(() => {
        setIsInstructionsLoading(true);
        fetch(`/api/repos/${repo.name}/instructions`)
            .then(res => {
                if (!res.ok) throw new Error("Failed to fetch instructions");
                return res.json();
            })
            .then(data => {
                setCurrentInstructions(data.current || '');
                setDraftInstructions(data.draft || '');
                setOriginalDraftInstructions(data.draft || '');
                setHasDraft(!!data.draft);
                setIsInstructionsLoading(false);
            })
            .catch(err => {
                console.error(err);
                setInstructionsError(err.message);
                setIsInstructionsLoading(false);
            });
    }, [repo.name]);

    useEffect(() => {
        if (activeTab === 'instructions') {
            fetchInstructions();
        }
    }, [activeTab, fetchInstructions]);

    const handleSwitchView = (newMode) => {
        if (newMode === 'yaml') {
            // Updating YAML from Form
            const newYaml = updateYamlFromState();
            setYamlContent(newYaml);
        } else {
            // Updating Form from YAML
            try {
                // Validate first
                yaml.load(yamlContent);
                parseYamlToState(yamlContent);
            } catch (e) {
                if (!window.confirm("YAML seems invalid. Switching to Simple view might lose changes. Continue?")) {
                    return;
                }
            }
        }
        setViewMode(newMode);
    };

    const handleConfigSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        let finalYaml = yamlContent;
        if (viewMode === 'simple') {
            finalYaml = updateYamlFromState();
        }

        try {
            const parsed = yaml.load(finalYaml);
            if (!parsed) throw new Error("YAML is empty or invalid");

            const currentRepoURL = parsed?.spec?.repoURL; // spec.repoURL
            const originalParsed = yaml.load(originalYamlContent);
            const originalRepoURL = originalParsed?.spec?.repoURL;

            // Note: structure check. k8s resources have top level fields.
            // RepoWatch has spec.
            // Check if repoURL changed.
            if (currentRepoURL && originalRepoURL && currentRepoURL !== originalRepoURL) {
                setError('Repository URL cannot be changed in this interface.');
                setIsLoading(false);
                return;
            }
        } catch (e) {
            setError('Invalid YAML content: ' + e.message);
            setIsLoading(false);
            return;
        }

        fetch(`/api/repos/${repo.name}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml: finalYaml })
        })
        .then(async (res) => {
            if (!res.ok) {
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    const data = await res.json();
                    throw new Error(data.error || 'Failed to update repository');
                } else {
                    const text = await res.text();
                    throw new Error(text || `Failed to update repository (${res.status})`);
                }
            }
            return res;
        })
        .then(() => {
            setIsLoading(false);
            onRepoUpdated();
        })
        .catch(err => {
            console.error(err);
            const hint = " This often happens for private or restricted repositories if you haven't provided a manual GitHub PAT in 'Settings'.";
            setError(err.message + hint);
            setIsLoading(false);
        });
    };

    const handleInstructionAction = (action) => {
        setInstructionsError('');
        setIsInstructionsLoading(true);

        const body = {
            current: currentInstructions,
            draft: draftInstructions,
            action: action
        };

        fetch(`/api/repos/${repo.name}/instructions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        .then(async (res) => {
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to update instructions');
            }
            return res;
        })
        .then(() => {
            if (action === 'publish' || action === 'discard_draft') {
                 fetchInstructions();
            } else if (action === 'save_draft') {
                 setHasDraft(true);
                 setOriginalDraftInstructions(draftInstructions);
                 setIsInstructionsLoading(false);
            }
        })
        .catch(err => {
            console.error(err);
            setInstructionsError(err.message);
            setIsInstructionsLoading(false);
        });
    };

    const handleIssueHandlerChange = (idx, field, value) => {
        const newHandlers = [...issueHandlers];
        newHandlers[idx] = { ...newHandlers[idx], [field]: value };
        setIssueHandlers(newHandlers);
    };

    return (
        <div className="add-repo-container" style={{maxWidth: '1000px'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <h2>Repository Settings: {repo.name}</h2>
                <div style={{display: 'flex', gap: '10px'}}>
                    {activeTab === 'config' && (
                        <>
                            <button 
                                type="button" 
                                className={`btn btn-sm ${viewMode === 'simple' ? 'btn-submit' : ''}`}
                                onClick={() => handleSwitchView('simple')}
                                disabled={isLoading}
                            >
                                Simple View
                            </button>
                            <button 
                                type="button" 
                                className={`btn btn-sm ${viewMode === 'yaml' ? 'btn-submit' : ''}`}
                                onClick={() => handleSwitchView('yaml')}
                                disabled={isLoading}
                            >
                                YAML View
                            </button>
                        </>
                    )}
                </div>
            </div>
            
            <div className="repo-tabs" style={{justifyContent: 'flex-start', marginBottom: '20px'}}>
                <button 
                    className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
                    onClick={() => setActiveTab('config')}
                >
                    Configuration
                </button>
                <button 
                    className={`tab-btn ${activeTab === 'instructions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('instructions')}
                >
                    User Instructions
                    {hasDraft && <span style={{marginLeft: '5px', color: '#orange'}}>●</span>} 
                </button>
            </div>

            {activeTab === 'config' && (
                <>
                    {error && <div className="message error">{error}</div>}
                    <form onSubmit={handleConfigSubmit} className="add-repo-form">
                        
                        {viewMode === 'yaml' ? (
                            <div className="form-group">
                                <label htmlFor="repoYaml">RepoWatch Spec (YAML):</label>
                                <textarea
                                    id="repoYaml"
                                    value={yamlContent}
                                    onChange={(e) => setYamlContent(e.target.value)}
                                    className="yaml-editor"
                                    rows={20}
                                    disabled={isLoading}
                                    style={{fontFamily: 'monospace', width: '100%', whiteSpace: 'pre'}}
                                />
                            </div>
                        ) : (
                            <div className="simple-config">
                                <div className="review-section">
                                    <h4>PR Reviews</h4>
                                    <div className="form-group">
                                        <label>Include PRs (comma separated numbers):</label>
                                        <input 
                                            type="text" 
                                            value={reviewConfig.pullRequests}
                                            onChange={(e) => setReviewConfig({...reviewConfig, pullRequests: e.target.value})}
                                            placeholder="e.g. 101, 102"
                                        />
                                    </div>
                                    <div className="form-group" style={{marginTop: '10px'}}>
                                        <label>Exclude PRs (comma separated numbers):</label>
                                        <input 
                                            type="text" 
                                            value={reviewConfig.excludePullRequests}
                                            onChange={(e) => setReviewConfig({...reviewConfig, excludePullRequests: e.target.value})}
                                            placeholder="e.g. 99, 100"
                                        />
                                    </div>
                                    <div className="form-group" style={{marginTop: '10px'}}>
                                        <label>Labels (One group per line, comma separated within line for AND):</label>
                                        <textarea
                                            value={reviewConfig.labels}
                                            onChange={(e) => setReviewConfig({...reviewConfig, labels: e.target.value})}
                                            rows={3}
                                            placeholder={"bug, p0\nfeature"}
                                            className="review-textarea"
                                            style={{minHeight: '60px'}}
                                        />
                                        <small>PR matches if it has ALL labels in ANY line.</small>
                                    </div>
                                </div>

                                <div className="review-section">
                                    <h4>Development Branches</h4>
                                    <div className="form-group">
                                        <label>Watch Branches (comma separated):</label>
                                        <input 
                                            type="text" 
                                            value={devConfig.branches}
                                            onChange={(e) => setDevConfig({...devConfig, branches: e.target.value})}
                                            placeholder="e.g. main, release-*"
                                        />
                                    </div>
                                    <div className="form-group" style={{marginTop: '10px'}}>
                                        <label>Exclude Branches (comma separated):</label>
                                        <input 
                                            type="text" 
                                            value={devConfig.excludeBranches}
                                            onChange={(e) => setDevConfig({...devConfig, excludeBranches: e.target.value})}
                                            placeholder="e.g. dependabot/*"
                                        />
                                    </div>
                                </div>

                                <div className="review-section">
                                    <h4>Issue Handlers</h4>
                                    {issueHandlers.length === 0 && <p>No issue handlers configured.</p>}
                                    {issueHandlers.map((handler, idx) => (
                                        <div key={idx} style={{marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid #eee'}}>
                                            <h5 style={{margin: '0 0 10px 0'}}>Handler: {handler.name}</h5>
                                            <div className="form-group">
                                                <label>Labels (comma separated):</label>
                                                <input 
                                                    type="text" 
                                                    value={handler.labels}
                                                    onChange={(e) => handleIssueHandlerChange(idx, 'labels', e.target.value)}
                                                    placeholder="e.g. bug"
                                                />
                                            </div>
                                            <div className="form-group" style={{marginTop: '10px'}}>
                                                <label>Include Issues (comma separated numbers):</label>
                                                <input 
                                                    type="text" 
                                                    value={handler.issues}
                                                    onChange={(e) => handleIssueHandlerChange(idx, 'issues', e.target.value)}
                                                />
                                            </div>
                                            <div className="form-group" style={{marginTop: '10px'}}>
                                                <label>Exclude Issues (comma separated numbers):</label>
                                                <input 
                                                    type="text" 
                                                    value={handler.excludeIssues}
                                                    onChange={(e) => handleIssueHandlerChange(idx, 'excludeIssues', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="form-actions">
                            <button type="submit" className="btn btn-submit" disabled={isLoading}>
                                {isLoading ? 'Updating...' : 'Update Repowatch'}
                            </button>
                            <button type="button" className="btn" onClick={onCancel} disabled={isLoading}>
                                Cancel
                            </button>
                        </div>
                    </form>
                </>
            )}

            {activeTab === 'instructions' && (
                <div className="instructions-container">
                    {instructionsError && <div className="message error">{instructionsError}</div>}
                    
                    <div style={{display: 'flex', gap: '20px', flexDirection: 'column'}}>
                        <div style={{flex: 1}}>
                            <h3>Current Instructions</h3>
                            <textarea
                                value={currentInstructions}
                                onChange={(e) => setCurrentInstructions(e.target.value)}
                                className="yaml-editor"
                                rows={20}
                                disabled={isInstructionsLoading}
                                style={{fontFamily: 'monospace', width: '100%', whiteSpace: 'pre'}}
                                placeholder="No user instructions defined."
                            />
                             <div className="form-actions" style={{marginTop: '10px'}}>
                                <button 
                                    className="btn btn-submit" 
                                    onClick={() => handleInstructionAction('publish')}
                                    disabled={isInstructionsLoading || (hasDraft && !window.confirm("This will overwrite current instructions with the content in this box and DISCARD the draft. Are you sure?"))}
                                    title="Save changes to current instructions directly"
                                >
                                    Update Current
                                </button>
                            </div>
                        </div>

                        {hasDraft && (
                            <div style={{flex: 1, borderTop: '1px solid #eee', paddingTop: '20px'}}>
                                <h3 style={{color: '#d9534f'}}>Proposed Draft</h3>
                                <textarea
                                    value={draftInstructions}
                                    onChange={(e) => setDraftInstructions(e.target.value)}
                                    className="yaml-editor"
                                    rows={20}
                                    disabled={isInstructionsLoading}
                                    style={{fontFamily: 'monospace', width: '100%', whiteSpace: 'pre', border: '1px solid #d9534f'}}
                                />
                                <div className="form-actions" style={{marginTop: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                                    <button 
                                        className="btn btn-submit" 
                                        style={{backgroundColor: '#5cb85c'}}
                                        onClick={() => {
                                            setCurrentInstructions(draftInstructions);
                                            setInstructionsError('');
                                            setIsInstructionsLoading(true);
                                            fetch(`/api/repos/${repo.name}/instructions`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ current: draftInstructions, draft: '', action: 'publish' })
                                            }).then(() => {
                                                fetchInstructions();
                                            }).catch(e => {
                                                setInstructionsError(e.message);
                                                setIsInstructionsLoading(false);
                                            });
                                        }}
                                        disabled={isInstructionsLoading}
                                    >
                                        Approve & Publish
                                    </button>
                                    <button 
                                        className="btn" 
                                        onClick={() => handleInstructionAction('save_draft')}
                                        disabled={isInstructionsLoading || draftInstructions === originalDraftInstructions}
                                    >
                                        Save Draft
                                    </button>
                                    <button 
                                        className="btn btn-delete" 
                                        onClick={() => {
                                            if (window.confirm("Are you sure you want to discard this draft?")) {
                                                handleInstructionAction('discard_draft');
                                            }
                                        }}
                                        disabled={isInstructionsLoading}
                                    >
                                        Reject / Discard
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                     <div className="form-actions" style={{marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px'}}>
                        <button type="button" className="btn" onClick={onCancel} disabled={isInstructionsLoading}>
                            Back / Cancel
                        </button>
                    </div>
                </div>
            )}
            
            <div style={{marginTop: '40px', borderTop: '1px solid #eee', paddingTop: '20px'}}>
                <h3 style={{color: '#d9534f'}}>Danger Zone</h3>
                <div style={{border: '1px solid #d9534f', padding: '15px', borderRadius: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <div>
                        <strong>Delete repowatch</strong>
                        <p style={{margin: '5px 0 0 0', fontSize: '0.9em', color: '#666'}}>
                            Unsubmitted reviews would be deleted. You can always add the repo again.
                        </p>
                    </div>
                    <DeleteRepo repo={repo} onRepoDeleted={onRepoDeleted} />
                </div>
            </div>
        </div>
    );
}

export default UpdateRepo;