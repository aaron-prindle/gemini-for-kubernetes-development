import React, { useState, useEffect, useCallback } from 'react';
import yaml from 'js-yaml';
import DeleteRepo from './DeleteRepo';

function UpdateRepo({ repo, onCancel, onRepoUpdated, onRepoDeleted }) {
    const [activeTab, setActiveTab] = useState('config'); // 'config' or 'instructions'
    const [yamlContent, setYamlContent] = useState('');
    const [originalYamlContent, setOriginalYamlContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Instructions state
    const [currentInstructions, setCurrentInstructions] = useState('');
    const [draftInstructions, setDraftInstructions] = useState('');
    const [originalDraftInstructions, setOriginalDraftInstructions] = useState('');
    const [hasDraft, setHasDraft] = useState(false);
    const [instructionsError, setInstructionsError] = useState('');
    const [isInstructionsLoading, setIsInstructionsLoading] = useState(false);

    // Filters state
    const [filters, setFilters] = useState({
        preferAssignedToSelf: false,
        labels: [], // Array of arrays of strings
        pullRequests: '',
        excludePullRequests: ''
    });

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
                }
                setIsLoading(false);
            })
            .catch(err => {
                console.error(err);
                setError(err.message);
                setIsLoading(false);
            });
    }, [repo.name]);

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

    const handleTabChange = (newTab) => {
        if (activeTab === 'config' && newTab === 'filters') {
            try {
                const parsed = yaml.load(yamlContent);
                // yamlContent represents the SPEC, so review is at top level
                const review = parsed?.review || {};
                
                let labels = review.labels;
                if (!Array.isArray(labels)) {
                    labels = [];
                }
                // Ensure it's array of arrays
                labels = labels.map(l => Array.isArray(l) ? l : []);

                setFilters({
                    preferAssignedToSelf: review.preferAssignedToSelf || false,
                    labels: labels,
                    pullRequests: (Array.isArray(review.pullRequests) ? review.pullRequests : []).join(', '),
                    excludePullRequests: (Array.isArray(review.excludePullRequests) ? review.excludePullRequests : []).join(', ')
                });
            } catch (e) {
                alert("Cannot switch to Filters view: Invalid YAML in Configuration tab.");
                return;
            }
        } else if (activeTab === 'filters' && newTab !== 'filters') {
            // Sync filters back to YAML
            try {
                let parsed = yaml.load(yamlContent);
                if (!parsed) parsed = {};
                // yamlContent represents the SPEC, so review is at top level
                if (!parsed.review) parsed.review = {};

                parsed.review.preferAssignedToSelf = filters.preferAssignedToSelf;
                parsed.review.labels = filters.labels.filter(g => g.length > 0); // Cleanup empty groups
                
                const parseList = (str) => str.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                parsed.review.pullRequests = parseList(filters.pullRequests);
                parsed.review.excludePullRequests = parseList(filters.excludePullRequests);

                setYamlContent(yaml.dump(parsed));
            } catch (e) {
                console.error("Failed to sync filters to YAML:", e);
                // Maybe alert?
            }
        }
        setActiveTab(newTab);
    };

    const handleConfigSubmit = async (e) => {
        e.preventDefault();
        
        let contentToSubmit = yamlContent;
        if (activeTab === 'filters') {
             // If submitting from filters tab, we need to generate YAML first
             try {
                let parsed = yaml.load(yamlContent); // Load existing to preserve other fields
                if (!parsed) parsed = {}; // Should have been loaded initially
                // yamlContent represents the SPEC, so review is at top level
                if (!parsed.review) parsed.review = {};

                parsed.review.preferAssignedToSelf = filters.preferAssignedToSelf;
                parsed.review.labels = filters.labels.filter(g => g.length > 0);
                
                const parseList = (str) => str.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                parsed.review.pullRequests = parseList(filters.pullRequests);
                parsed.review.excludePullRequests = parseList(filters.excludePullRequests);

                contentToSubmit = yaml.dump(parsed);
                // Also update state so if we fail we stay in sync? 
                // Actually handleConfigSubmit usually just submits.
            } catch (e) {
                setError("Failed to generate YAML from filters: " + e.message);
                return;
            }
        }

        setError('');
        setIsLoading(true);

        try {
            const parsed = yaml.load(contentToSubmit);
            if (!parsed) throw new Error("YAML is empty or invalid");

            const currentRepoURL = parsed?.repoURL;
            const originalParsed = yaml.load(originalYamlContent);
            const originalRepoURL = originalParsed?.repoURL;

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
            body: JSON.stringify({ yaml: contentToSubmit })
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
            if (activeTab === 'filters') {
                 // Update yamlContent state to match what we just submitted
                 setYamlContent(contentToSubmit);
            }
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
                 // Refresh to clear draft or update current
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

    return (
        <div className="add-repo-container" style={{maxWidth: '1000px'}}>
            <h2>Repository Settings: {repo.name}</h2>
            
            <div className="repo-tabs" style={{justifyContent: 'flex-start', marginBottom: '20px'}}>
                <button 
                    className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
                    onClick={() => handleTabChange('config')}
                >
                    Configuration
                </button>
                <button 
                    className={`tab-btn ${activeTab === 'filters' ? 'active' : ''}`}
                    onClick={() => handleTabChange('filters')}
                >
                    Filters
                </button>
                <button 
                    className={`tab-btn ${activeTab === 'instructions' ? 'active' : ''}`}
                    onClick={() => handleTabChange('instructions')}
                >
                    User Instructions
                    {hasDraft && <span style={{marginLeft: '5px', color: '#orange'}}>●</span>} 
                </button>
            </div>

            {activeTab === 'config' && (
                <>
                    {error && <div className="message error">{error}</div>}
                    <form onSubmit={handleConfigSubmit} className="add-repo-form">
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

            {activeTab === 'filters' && (
                <>
                    {error && <div className="message error">{error}</div>}
                    <form onSubmit={handleConfigSubmit} className="add-repo-form">
                        <div className="form-group">
                             <div style={{marginBottom: '15px'}}>
                                <label style={{display: 'flex', alignItems: 'center', cursor: 'pointer'}}>
                                    <input 
                                        type="checkbox" 
                                        checked={filters.preferAssignedToSelf} 
                                        onChange={e => setFilters({...filters, preferAssignedToSelf: e.target.checked})}
                                        style={{marginRight: '10px'}}
                                    />
                                    <strong>Prefer Assigned To Self</strong>
                                </label>
                                <p style={{margin: '5px 0 0 25px', fontSize: '0.9em', color: '#666'}}>
                                    If checked, the agent will prioritize reviewing PRs assigned to the authenticated user (or the bot user).
                                </p>
                             </div>

                             <div style={{marginBottom: '20px'}}>
                                <label>Included Pull Requests (comma separated numbers):</label>
                                <input 
                                    type="text" 
                                    value={filters.pullRequests} 
                                    onChange={e => setFilters({...filters, pullRequests: e.target.value})}
                                    placeholder="e.g. 123, 456"
                                    style={{width: '100%', padding: '8px'}}
                                />
                             </div>

                             <div style={{marginBottom: '20px'}}>
                                <label>Excluded Pull Requests (comma separated numbers):</label>
                                <input 
                                    type="text" 
                                    value={filters.excludePullRequests} 
                                    onChange={e => setFilters({...filters, excludePullRequests: e.target.value})}
                                    placeholder="e.g. 789, 101"
                                    style={{width: '100%', padding: '8px'}}
                                />
                             </div>

                             <div style={{marginBottom: '20px'}}>
                                <label>Label Filters (Groups are OR-ed, Labels within group are AND-ed):</label>
                                <div style={{background: '#f9f9f9', padding: '15px', borderRadius: '5px', border: '1px solid #ddd'}}>
                                    {filters.labels.map((group, groupIdx) => (
                                        <div key={groupIdx} style={{marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                                            <span style={{fontWeight: 'bold'}}>Group {groupIdx + 1}:</span>
                                            <div style={{display: 'flex', flexWrap: 'wrap', gap: '5px', flex: 1}}>
                                                {group.map((label, labelIdx) => (
                                                    <span key={labelIdx} style={{background: '#e1f5fe', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', fontSize: '0.9em'}}>
                                                        {label}
                                                        <span 
                                                            onClick={() => {
                                                                const newLabels = [...filters.labels];
                                                                newLabels[groupIdx] = newLabels[groupIdx].filter((_, i) => i !== labelIdx);
                                                                setFilters({...filters, labels: newLabels});
                                                            }}
                                                            style={{marginLeft: '5px', cursor: 'pointer', fontWeight: 'bold', color: '#888'}}
                                                        >×</span>
                                                    </span>
                                                ))}
                                                <input 
                                                    type="text" 
                                                    placeholder="+ Add Label"
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            const val = e.target.value.trim();
                                                            if (val) {
                                                                const newLabels = [...filters.labels];
                                                                newLabels[groupIdx] = [...newLabels[groupIdx], val];
                                                                setFilters({...filters, labels: newLabels});
                                                                e.target.value = '';
                                                            }
                                                        }
                                                    }}
                                                    style={{border: 'none', background: 'transparent', minWidth: '80px', outline: 'none', borderBottom: '1px solid #ccc'}}
                                                />
                                            </div>
                                            <button 
                                                type="button" 
                                                className="btn btn-delete" 
                                                style={{padding: '2px 8px', fontSize: '0.8em'}}
                                                onClick={() => {
                                                    const newLabels = filters.labels.filter((_, i) => i !== groupIdx);
                                                    setFilters({...filters, labels: newLabels});
                                                }}
                                            >
                                                Remove Group
                                            </button>
                                        </div>
                                    ))}
                                    <button 
                                        type="button" 
                                        className="btn" 
                                        onClick={() => setFilters({...filters, labels: [...filters.labels, []]})}
                                        style={{marginTop: '10px', fontSize: '0.9em'}}
                                    >
                                        + Add Filter Group
                                    </button>
                                </div>
                             </div>
                        </div>
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
                                            // Copy draft to current then publish
                                            setCurrentInstructions(draftInstructions);
                                            // We need to wait for state update? No, we pass values to API.
                                            // But handleInstructionAction uses state 'currentInstructions'.
                                            // So we should construct a special call.
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
